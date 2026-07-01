/**
 * Decrypt and parse South African driver's licence PDF417 (SADL).
 * Ported from https://github.com/yushulx/south-africa-driving-license (MIT).
 */

const V1 = [0x01, 0xe1, 0x02, 0x45] as const;
const V2 = [0x01, 0x9b, 0x09, 0x45] as const;

const PK_V1_128 = `
-----BEGIN RSA PUBLIC KEY-----
MIGXAoGBAP7S4cJ+M2MxbncxenpSxUmBOVGGvkl0dgxyUY1j4FRKSNCIszLFsMNwx2XWXZg8H53gpCsxDMwHrncL0rYdak3M6sdXaJvcv2CEePrzEvYIfMSWw3Ys9cRlHK7No0mfrn7bfrQOPhjrMEFw6R7VsVaqzm9DLW7KbMNYUd6MZ49nAhEAu3l//ex/nkLJ1vebE3BZ2w==
-----END RSA PUBLIC KEY-----
`;

const PK_V1_74 = `
-----BEGIN RSA PUBLIC KEY-----
MGACSwD/POxrX0Djw2YUUbn8+u866wbcIynA5vTczJJ5cmcWzhW74F7tLFcRvPj1tsj3J221xDv6owQNwBqxS5xNFvccDOXqlT8MdUxrFwIRANsFuoItmswz+rfY9Cf5zmU=
-----END RSA PUBLIC KEY-----
`;

const PK_V2_128 = `
-----BEGIN RSA PUBLIC KEY-----
MIGWAoGBAMqfGO9sPz+kxaRh/qVKsZQGul7NdG1gonSS3KPXTjtcHTFfexA4MkGAmwKeu9XeTRFgMMxX99WmyaFvNzuxSlCFI/foCkx0TZCFZjpKFHLXryxWrkG1Bl9++gKTvTJ4rWk1RvnxYhm3n/Rxo2NoJM/822Oo7YBZ5rmk8NuJU4HLAhAYcJLaZFTOsYU+aRX4RmoF
-----END RSA PUBLIC KEY-----
`;

const PK_V2_74 = `
-----BEGIN RSA PUBLIC KEY-----
MF8CSwC0BKDfEdHKz/GhoEjU1XP5U6YsWD10klknVhpteh4rFAQlJq9wtVBUc5DqbsdI0w/bga20kODDahmGtASy9fae9dobZj5ZUJEw5wIQMJz+2XGf4qXiDJu0R2U4Kw==
-----END RSA PUBLIC KEY-----
`;

export type SaDriversLicence = {
  vehicleCodes: string[];
  surname: string;
  initials: string;
  prdpCode: string;
  idCountryOfIssue: string;
  licenseCountryOfIssue: string;
  vehicleRestrictions: string[];
  licenseNumber: string;
  idNumber: string;
  idNumberType: string;
  licenseCodeIssueDates: string[];
  driverRestrictionCodes: string;
  prdpExpiryDate: string;
  licenseIssueNumber: string;
  birthdate: string;
  licenseIssueDate: string;
  licenseExpiryDate: string;
  gender: "male" | "female";
};

export type DriversLicenceParsedFields = {
  documentType: "drivers_licence";
  personFullName?: string;
  personIdNumber?: string;
  driversLicenceNumber?: string;
  licenceExpiryDate?: string;
  licenceValidFrom?: string;
  vehicleCodes?: string[];
  prdpCode?: string;
  prdpExpiryDate?: string;
};

type RsaPublicKey = { n: bigint; e: bigint };

const RSA_KEYS = {
  v1_128: null as RsaPublicKey | null,
  v1_74: null as RsaPublicKey | null,
  v2_128: null as RsaPublicKey | null,
  v2_74: null as RsaPublicKey | null,
};

function parsePkcs1PubKey(pem: string): RsaPublicKey {
  const lines = pem.trim().split("\n");
  const b64 = lines.filter((l) => !l.startsWith("-----")).join("");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  let pos = 0;
  const readLength = (): number => {
    let length = der[pos++];
    if (length & 0x80) {
      const numBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | der[pos++];
      }
    }
    return length;
  };

  const readInt = (): bigint => {
    if (der[pos++] !== 0x02) throw new Error("Expected INTEGER");
    const length = readLength();
    let value = 0n;
    for (let i = 0; i < length; i++) {
      value = (value << 8n) | BigInt(der[pos++]);
    }
    return value;
  };

  if (der[pos++] !== 0x30) throw new Error("Expected SEQUENCE");
  readLength();
  const n = readInt();
  const e = readInt();
  return { n, e };
}

function rsaKeyFor(pem: string, cacheKey: keyof typeof RSA_KEYS): RsaPublicKey {
  const cached = RSA_KEYS[cacheKey];
  if (cached) return cached;
  const parsed = parsePkcs1PubKey(pem);
  RSA_KEYS[cacheKey] = parsed;
  return parsed;
}

function rsaDecryptBlock(block: Uint8Array, key: RsaPublicKey): Uint8Array {
  const { n, e } = key;
  let input = 0n;
  for (const byte of block) {
    input = (input << 8n) | BigInt(byte);
  }
  const output = modPow(input, e, n);
  const result = new Uint8Array(block.length);
  let rem = output;
  for (let i = block.length - 1; i >= 0; i--) {
    result[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return result;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

export function latin1ToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Fast header check — no allocations (safe on mobile scan loop). */
export function looksLikeSadlEncryptedString(raw: string): boolean {
  if (raw.length !== 720) return false;
  const b0 = raw.charCodeAt(0) & 0xff;
  const b1 = raw.charCodeAt(1) & 0xff;
  const b2 = raw.charCodeAt(2) & 0xff;
  const b3 = raw.charCodeAt(3) & 0xff;
  const v1 = b0 === V1[0] && b1 === V1[1] && b2 === V1[2] && b3 === V1[3];
  const v2 = b0 === V2[0] && b1 === V2[1] && b2 === V2[2] && b3 === V2[3];
  return v1 || v2;
}

export function isSadlEncryptedPayload(bytes: Uint8Array): boolean {
  if (bytes.length !== 720) return false;
  const v1 =
    bytes[0] === V1[0] &&
    bytes[1] === V1[1] &&
    bytes[2] === V1[2] &&
    bytes[3] === V1[3];
  const v2 =
    bytes[0] === V2[0] &&
    bytes[1] === V2[1] &&
    bytes[2] === V2[2] &&
    bytes[3] === V2[3];
  return v1 || v2;
}

export function isSadlEncryptedString(raw: string): boolean {
  return looksLikeSadlEncryptedString(raw);
}

/** Chunked latin1 → base64 (avoids huge single-string pressure on mobile). */
export function sadlLatin1ToBase64(raw: string): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < raw.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, raw.length);
    for (let j = i; j < end; j++) {
      binary += String.fromCharCode(raw.charCodeAt(j) & 0xff);
    }
  }
  return btoa(binary);
}

function decryptSadlData(data: Uint8Array): Uint8Array {
  const header = data.subarray(0, 6);
  const isV2 =
    header[0] === V2[0] &&
    header[1] === V2[1] &&
    header[2] === V2[2] &&
    header[3] === V2[3];

  const key128 = rsaKeyFor(isV2 ? PK_V2_128 : PK_V1_128, isV2 ? "v2_128" : "v1_128");
  const key74 = rsaKeyFor(isV2 ? PK_V2_74 : PK_V1_74, isV2 ? "v2_74" : "v1_74");

  const all = new Uint8Array(684);
  let offset = 0;
  let start = 6;

  for (let i = 0; i < 5; i++) {
    const block = data.subarray(start, start + 128);
    all.set(rsaDecryptBlock(block, key128), offset);
    offset += 128;
    start += 128;
  }

  const lastBlock = data.subarray(start, start + 74);
  all.set(rsaDecryptBlock(lastBlock, key74), offset);

  return all;
}

function readNibbleDateString(nibbleQueue: number[]): string {
  const m = nibbleQueue.shift();
  if (m === undefined || m === 10) return "";

  const c = nibbleQueue.shift() ?? 0;
  const d = nibbleQueue.shift() ?? 0;
  const y = nibbleQueue.shift() ?? 0;
  const m1 = nibbleQueue.shift() ?? 0;
  const m2 = nibbleQueue.shift() ?? 0;
  const d1 = nibbleQueue.shift() ?? 0;
  const d2 = nibbleQueue.shift() ?? 0;

  return `${m}${c}${d}${y}/${m1}${m2}/${d1}${d2}`;
}

function readNibbleDateList(nibbleQueue: number[], length: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < length; i++) {
    const date = readNibbleDateString(nibbleQueue);
    if (date) dates.push(date);
  }
  return dates;
}

function readStrings(data: Uint8Array, startIndex: number, length: number): [string[], number] {
  const strings: string[] = [];
  let index = startIndex;
  let i = 0;

  while (i < length && index < data.length) {
    let value = "";
    while (index < data.length) {
      const currentByte = data[index];
      index += 1;

      if (currentByte === 0xe0) break;
      if (currentByte === 0xe1) {
        if (value) i += 1;
        break;
      }
      value += String.fromCharCode(currentByte);
    }
    i += 1;
    if (value) strings.push(value);
  }

  return [strings, index];
}

function readString(
  data: Uint8Array,
  startIndex: number,
): [string, number, number] {
  let value = "";
  let delimiter = 0xe0;
  let index = startIndex;

  while (index < data.length) {
    const currentByte = data[index];
    index += 1;

    if (currentByte === 0xe0 || currentByte === 0xe1) {
      delimiter = currentByte;
      break;
    }
    value += String.fromCharCode(currentByte);
  }

  return [value, index, delimiter];
}

function parseSadlDecrypted(data: Uint8Array): SaDriversLicence {
  let index = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x82) {
      index = i;
      break;
    }
  }

  const [vehicleCodes, idx1] = readStrings(data, index + 2, 4);
  index = idx1;

  const [surname, idx2, delimiter] = readString(data, index);
  index = idx2;

  const [initials, idx3, delim2] = readString(data, index);
  index = idx3;
  let delim = delim2;

  let prdpCode = "";
  if (delim === 0xe0) {
    const [code, idx4, delim3] = readString(data, index);
    prdpCode = code;
    index = idx4;
    delim = delim3;
  }

  const [idCountryOfIssue, idx5, delim4] = readString(data, index);
  index = idx5;
  delim = delim4;

  const [licenseCountryOfIssue, idx6, delim5] = readString(data, index);
  index = idx6;
  delim = delim5;

  const [vehicleRestrictions, idx7] = readStrings(data, index, 4);
  index = idx7;

  const [licenseNumber, idx8] = readString(data, index);
  index = idx8;

  let idNumber = "";
  for (let i = 0; i < 13; i++) {
    idNumber += String.fromCharCode(data[index]);
    index += 1;
  }

  const idNumberType = `${data[index].toString().padStart(2, "0")}`;
  index += 1;

  const nibbleQueue: number[] = [];
  const nibbleEnd = Math.min(data.length, index + 120);
  while (index < nibbleEnd) {
    const currentByte = data[index];
    index += 1;
    if (currentByte === 0x57) break;
    nibbleQueue.push(currentByte >> 4, currentByte & 0x0f);
  }

  const licenseCodeIssueDates = readNibbleDateList(nibbleQueue, 4);
  const driverRestrictionCodes = `${nibbleQueue.shift() ?? 0}${nibbleQueue.shift() ?? 0}`;
  const prdpExpiryDate = readNibbleDateString(nibbleQueue);
  const licenseIssueNumber = `${nibbleQueue.shift() ?? 0}${nibbleQueue.shift() ?? 0}`;
  const birthdate = readNibbleDateString(nibbleQueue);
  const licenseIssueDate = readNibbleDateString(nibbleQueue);
  const licenseExpiryDate = readNibbleDateString(nibbleQueue);
  const genderCode = `${nibbleQueue.shift() ?? 0}${nibbleQueue.shift() ?? 0}`;
  const gender: "male" | "female" = genderCode === "01" ? "male" : "female";

  return {
    vehicleCodes,
    surname,
    initials,
    prdpCode,
    idCountryOfIssue,
    licenseCountryOfIssue,
    vehicleRestrictions,
    licenseNumber,
    idNumber,
    idNumberType,
    licenseCodeIssueDates,
    driverRestrictionCodes,
    prdpExpiryDate,
    licenseIssueNumber,
    birthdate,
    licenseIssueDate,
    licenseExpiryDate,
    gender,
  };
}

export function parseSaDriversLicenceBytes(
  bytes: Uint8Array,
  encrypted = true,
): SaDriversLicence | null {
  if (encrypted && bytes.length !== 720) return null;
  if (encrypted && !isSadlEncryptedPayload(bytes)) return null;

  try {
    const payload = encrypted ? decryptSadlData(bytes) : bytes;
    return parseSadlDecrypted(payload);
  } catch {
    return null;
  }
}

export function driversLicenceToParsedFields(dl: SaDriversLicence): DriversLicenceParsedFields {
  const personFullName = [dl.initials, dl.surname].filter(Boolean).join(" ").trim();
  return {
    documentType: "drivers_licence",
    personFullName: personFullName || undefined,
    personIdNumber: dl.idNumber || undefined,
    driversLicenceNumber: dl.licenseNumber || undefined,
    licenceExpiryDate: dl.licenseExpiryDate || undefined,
    licenceValidFrom: dl.licenseIssueDate || undefined,
    vehicleCodes: dl.vehicleCodes.length ? dl.vehicleCodes : undefined,
    prdpCode: dl.prdpCode || undefined,
    prdpExpiryDate: dl.prdpExpiryDate || undefined,
  };
}
