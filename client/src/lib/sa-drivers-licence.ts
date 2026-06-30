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

function parsePkcs1PubKey(pem: string): { n: bigint; e: bigint } {
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

function rsaDecryptBlock(block: Uint8Array, pem: string): Uint8Array {
  const { n, e } = parsePkcs1PubKey(pem);
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
  return isSadlEncryptedPayload(latin1ToBytes(raw));
}

function decryptSadlData(data: Uint8Array): Uint8Array {
  const header = data.subarray(0, 6);
  let pk128 = PK_V1_128;
  let pk74 = PK_V1_74;

  if (
    header[0] === V2[0] &&
    header[1] === V2[1] &&
    header[2] === V2[2] &&
    header[3] === V2[3]
  ) {
    pk128 = PK_V2_128;
    pk74 = PK_V2_74;
  }

  const all = new Uint8Array(684);
  let offset = 0;
  let start = 6;

  for (let i = 0; i < 5; i++) {
    const block = data.subarray(start, start + 128);
    const decrypted = rsaDecryptBlock(block, pk128);
    all.set(decrypted, offset);
    offset += 128;
    start += 128;
  }

  const lastBlock = data.subarray(start, start + 74);
  const decryptedLast = rsaDecryptBlock(lastBlock, pk74);
  all.set(decryptedLast, offset);

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

  let [surname, idx2, delimiter] = readString(data, index);
  index = idx2;

  let [initials, idx3, delim2] = readString(data, index);
  index = idx3;
  delimiter = delim2;

  let prdpCode = "";
  if (delimiter === 0xe0) {
    const [code, idx4, delim3] = readString(data, index);
    prdpCode = code;
    index = idx4;
    delimiter = delim3;
  }

  const [idCountryOfIssue, idx5, delim4] = readString(data, index);
  index = idx5;
  delimiter = delim4;

  const [licenseCountryOfIssue, idx6, delim5] = readString(data, index);
  index = idx6;
  delimiter = delim5;

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
  while (true) {
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

export function parseSaDriversLicenceRaw(raw: string): SaDriversLicence | null {
  const bytes = latin1ToBytes(raw);
  return parseSaDriversLicenceBytes(bytes, true);
}
