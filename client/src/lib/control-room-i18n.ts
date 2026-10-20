export type ControlRoomLang = "en" | "af";

const STORAGE_KEY = "omt_control_room_lang";

export function readControlRoomLang(): ControlRoomLang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "af" ? "af" : "en";
  } catch {
    return "en";
  }
}

export function writeControlRoomLang(lang: ControlRoomLang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
}

export type ControlRoomCopy = {
  /** Label on the button: the language you switch to. */
  toggleLabel: string;
  allClearTitle: string;
  activePanics: (n: number) => string;
  liveIncidentsCount: (n: number) => string;
  updated: string;
  now: string;
  justNow: string;
  noSignal: string;
  noActivity: string;
  secondsAgo: (n: number) => string;
  minutesAgo: (n: number) => string;
  hoursAgo: (n: number) => string;
  daysAgo: (n: number) => string;
  controlRoom: string;
  operations: string;
  liveMonitor: string;
  panicSos: string;
  allGroups: string;
  selectGroup: string;
  allSites: string;
  central: string;
  readOnly: string;
  activeIncidents: string;
  noneRightNow: string;
  openLiveMonitor: string;
  panicsToday: string;
  sinceMidnight: string;
  loggedToday: string;
  occurrencesToday: string;
  closedToday: string;
  noLongerLive: string;
  siteMonitor: string;
  team: string;
  fleet: string;
  member: string;
  lastActivity: string;
  viewFleet: string;
  moving: string;
  idle: string;
  offline: string;
  noTeamInGroup: string;
  noTeamOnSite: string;
  noTrackersInGroup: string;
  noVehiclesOnSite: string;
  liveNow: string;
  idleLong: string;
  live: string;
  off: string;
  signal: string;
  gps: string;
  liveIncidents: string;
  activeCount: (n: number) => string;
  allClear: string;
  mapHint: string;
  locationPending: string;
  incident: string;
  viewAttachments: (subject: string) => string;
  todaysOccurrences: string;
  fullBook: string;
  emptyToday: string;
  thisWeek: string;
  showAll: string;
  whiteBackground: string;
  darkBackground: string;
  viewWeek: string;
  emptyWeek: string;
  uncategorised: string;
  unknownReporter: string;
  logged: string;
  occurred: string;
  book: string;
  fromPanic: string;
  hasAttachments: string;
  responding: string;
  available: string;
  offDuty: string;
  role: (role: string) => string;
  lastLocation: string;
  unknownTime: string;
  openInMaps: string;
  copyCoordinates: string;
  coordinatesCopied: string;
  couldNotCopy: string;
  noGpsForMember: string;
  openLiveIncident: string;
  noGpsYet: string;
  noGpsDescription: (name: string) => string;
  attachments: string;
  nav: {
    activeGroup: string;
    selectGroup: string;
    requestAccess: string;
    navigation: string;
    dashboard: string;
    occurrenceBook: string;
    accessControl: string;
    patrol: string;
    siteSurvey: string;
    analytics: string;
    liveIncident: string;
    assets: string;
    cameras: string;
    admin: string;
    users: string;
    sites: string;
    fieldSetup: string;
    importData: string;
    groups: string;
    chat: string;
    notifications: string;
    enableNotifications: string;
    notificationsBlocked: string;
    signOut: string;
    privacy: string;
    poweredBy: string;
  };
  screen: {
    incident: string;
    incidents: string;
    hotspot: string;
    leadType: string;
    peakHour: string;
    noIncidentsPeriod: string;
    to: string;
    clear: string;
    charts: string;
    map: string;
    total: string;
    topLocation: string;
    topType: string;
    allDates: string;
    filteringBy: string;
    clearAll: string;
    location: string;
    type: string;
    incidentTime: string;
    incidentDate: string;
    dayOfWeek: string;
    analyticsMap: string;
    myIncidents: string;
    thisWeek: string;
    today: string;
    allRecords: string;
    inView: string;
    noIncidentsView: string;
    overview: string;
    gateDesk: string;
    onSite: string;
    destinations: string;
    noDestinations: string;
    manager: string;
    field: string;
    route: string;
    routes: string;
    noRoutesYet: string;
    noPatrolAssigned: string;
    security: string;
    siteSurveyTitle: string;
    siteSurveyBody: string;
    standby: string;
    autoRefresh: string;
    active: string;
    status: string;
    liveResponse: string;
    vehicle: string;
    vehicles: string;
    vehicleDetail: string;
    fleetBoard: string;
    addVehicle: string;
    asset: string;
    assetsWord: string;
    assetRegister: string;
    addAsset: string;
    camera: string;
    camerasConfigured: string;
    addCamera: string;
    noCameras: string;
    last7Days: string;
    unread: string;
    noNotifications: string;
    user: string;
    usersWord: string;
    addUser: string;
    site: string;
    sitesWord: string;
    addPosition: string;
    positions: string;
    enrolled: string;
    pending: string;
    admin: string;
    configured: string;
    formFields: string;
    types: string;
    locations: string;
    occurrenceImport: string;
    rows: string;
    newGroup: string;
    group: string;
    groupsWord: string;
    custom: string;
    members: string;
  };
};

const en: ControlRoomCopy = {
  toggleLabel: "Afrikaans",
  allClearTitle: "All Clear — No Active Incidents",
  activePanics: (n) => `${n} Active Panic${n === 1 ? "" : "s"}`,
  liveIncidentsCount: (n) => `${n} Live Incident${n === 1 ? "" : "s"}`,
  updated: "Updated",
  now: "now",
  justNow: "Just now",
  noSignal: "No signal",
  noActivity: "No activity",
  secondsAgo: (n) => `${n}s ago`,
  minutesAgo: (n) => `${n}m ago`,
  hoursAgo: (n) => `${n}h ago`,
  daysAgo: (n) => `${n}d ago`,
  controlRoom: "Control Room",
  operations: "Operations",
  liveMonitor: "Live Monitor",
  panicSos: "Panic / SOS",
  allGroups: "All Groups",
  selectGroup: "Select group",
  allSites: "All sites",
  central: " (Central)",
  readOnly: " · read-only",
  activeIncidents: "Active Incidents",
  noneRightNow: "none right now",
  openLiveMonitor: "open live monitor",
  panicsToday: "Panics Today",
  sinceMidnight: "since midnight",
  loggedToday: "Logged Today",
  occurrencesToday: "occurrences today",
  closedToday: "Closed Today",
  noLongerLive: "no longer live",
  siteMonitor: "Site Monitor",
  team: "Team",
  fleet: "Fleet",
  member: "Member",
  lastActivity: "Last activity",
  viewFleet: "View fleet",
  moving: "Moving",
  idle: "Idle",
  offline: "Offline",
  noTeamInGroup: "No team members in this group.",
  noTeamOnSite: "No team assigned to this site.",
  noTrackersInGroup: "No GPS trackers in this group.",
  noVehiclesOnSite: "No vehicles linked to this site.",
  liveNow: "Live now",
  idleLong: "4h+ idle",
  live: "Live",
  off: "Off",
  signal: "Signal",
  gps: "GPS",
  liveIncidents: "Live Incidents",
  activeCount: (n) => `${n} active`,
  allClear: "All clear",
  mapHint: "Sites, team GPS & fleet on map",
  locationPending: "Location pending",
  incident: "Incident",
  viewAttachments: (subject) => `View attachments for ${subject}`,
  todaysOccurrences: "Today's Occurrences",
  fullBook: "Full book →",
  emptyToday: "No occurrences logged today yet.",
  thisWeek: "This Week",
  showAll: "All three",
  whiteBackground: "White",
  darkBackground: "Dark",
  viewWeek: "View week →",
  emptyWeek: "No other occurrences this week.",
  uncategorised: "Uncategorised",
  unknownReporter: "Unknown reporter",
  logged: "Logged",
  occurred: "Occurred",
  book: "Book →",
  fromPanic: "Originated from panic alert",
  hasAttachments: "Has attachments",
  responding: "Responding",
  available: "Available",
  offDuty: "Off duty",
  role: (role) => {
    const mapped: Record<string, string> = {
      administrator: "Administrator",
      control_room: "Control Room",
      supervisor: "Supervisor",
      reporter: "Reporter",
      access_controller: "Access Controller",
      patrol_user: "Patrol User",
    };
    return mapped[role] ?? titleCaseRole(role);
  },
  lastLocation: "Last / current location",
  unknownTime: "Unknown time",
  openInMaps: "Open in Maps",
  copyCoordinates: "Copy coordinates",
  coordinatesCopied: "Coordinates copied",
  couldNotCopy: "Could not copy",
  noGpsForMember: "No GPS position recorded for this member yet.",
  openLiveIncident: "Open live incident",
  noGpsYet: "No GPS yet",
  noGpsDescription: (name) => `${name} has no recorded position to show on the map.`,
  attachments: "Attachments",
  nav: {
    activeGroup: "Active Group",
    selectGroup: "Select a Group",
    requestAccess: "Request access to another Group →",
    navigation: "Navigation",
    dashboard: "Dashboard",
    occurrenceBook: "Occurrence Book",
    accessControl: "Access Control",
    patrol: "Patrol",
    siteSurvey: "Site Survey",
    analytics: "Analytics",
    liveIncident: "Live Incident",
    assets: "Assets",
    cameras: "Cameras",
    admin: "Admin",
    users: "Users",
    sites: "Sites",
    fieldSetup: "Field setup",
    importData: "Import Data",
    groups: "Groups",
    chat: "Chat",
    notifications: "Notifications",
    enableNotifications: "Enable Notifications",
    notificationsBlocked: "Blocked by browser — open site settings and allow notifications, then try again.",
    signOut: "Sign Out",
    privacy: "Privacy Policy",
    poweredBy: "powered by",
  },
  screen: {
    incident: "Incident",
    incidents: "Incidents",
    hotspot: "Hotspot",
    leadType: "Lead type",
    peakHour: "Peak hour",
    noIncidentsPeriod: "No incidents in this period — adjust the date range or clear filters.",
    to: "to",
    clear: "Clear",
    charts: "Charts",
    map: "Map",
    total: "Total",
    topLocation: "Top location",
    topType: "Top type",
    allDates: "All dates",
    filteringBy: "Filtering by:",
    clearAll: "Clear all",
    location: "Location",
    type: "Type",
    incidentTime: "Incident Time",
    incidentDate: "Incident Date",
    dayOfWeek: "Day of Week",
    analyticsMap: "Analytics · Map",
    myIncidents: "My Incidents",
    thisWeek: "This week",
    today: "Today",
    allRecords: "All records",
    inView: "In view",
    noIncidentsView: "No incidents in this view — adjust filters or report a new incident.",
    overview: "Overview",
    gateDesk: "Gate desk",
    onSite: "On site",
    destinations: "Destinations",
    noDestinations: "No active destinations configured yet.",
    manager: "Manager",
    field: "Field",
    route: "Route",
    routes: "Routes",
    noRoutesYet: "No routes yet — add a route to get started.",
    noPatrolAssigned: "No patrol routes assigned yet.",
    security: "Security",
    siteSurveyTitle: "Security site surveys",
    siteSurveyBody: "Conduct structured site checklists, capture evidence with GPS, and share PDF reports with clients.",
    standby: "Standby",
    autoRefresh: "Auto-refresh 5s",
    active: "Active",
    status: "Status",
    liveResponse: "Live response in progress",
    vehicle: "Vehicle",
    vehicles: "Vehicles",
    vehicleDetail: "Vehicle detail",
    fleetBoard: "Fleet board",
    addVehicle: "Add vehicle",
    asset: "Asset",
    assetsWord: "Assets",
    assetRegister: "Asset register",
    addAsset: "Add asset",
    camera: "camera configured",
    camerasConfigured: "cameras configured",
    addCamera: "Add camera",
    noCameras: "No cameras yet — add your first RTSP source to start monitoring.",
    last7Days: "Last 7 days",
    unread: "Unread",
    noNotifications: "No notifications in the last 7 days.",
    user: "User",
    usersWord: "Users",
    addUser: "Add User",
    site: "Site",
    sitesWord: "Sites",
    addPosition: "Add position",
    positions: "Positions",
    enrolled: "Enrolled",
    pending: "Pending",
    admin: "Admin",
    configured: "Configured",
    formFields: "Form fields",
    types: "Types",
    locations: "Locations",
    occurrenceImport: "Occurrence import",
    rows: "Rows",
    newGroup: "New Group",
    group: "Group",
    groupsWord: "Groups",
    custom: "Custom",
    members: "Members",
  },
};

const af: ControlRoomCopy = {
  toggleLabel: "English",
  allClearTitle: "Alles veilig — Geen aktiewe voorvalle",
  activePanics: (n) => (n === 1 ? "1 aktiewe paniek" : `${n} aktiewe panieke`),
  liveIncidentsCount: (n) => (n === 1 ? "1 lewendige voorval" : `${n} lewendige voorvalle`),
  updated: "Opgedateer",
  now: "nou",
  justNow: "Nou net",
  noSignal: "Geen sein",
  noActivity: "Geen aktiwiteit",
  secondsAgo: (n) => `${n}s gelede`,
  minutesAgo: (n) => `${n} min gelede`,
  hoursAgo: (n) => `${n} u gelede`,
  daysAgo: (n) => `${n} d gelede`,
  controlRoom: "Beheerkamer",
  operations: "Operasies",
  liveMonitor: "Lewendige monitor",
  panicSos: "Paniek / SOS",
  allGroups: "Alle groepe",
  selectGroup: "Kies groep",
  allSites: "Alle terreine",
  central: " (Sentraal)",
  readOnly: " · leesalleen",
  activeIncidents: "Aktiewe voorvalle",
  noneRightNow: "niks nou nie",
  openLiveMonitor: "maak lewendige monitor oop",
  panicsToday: "Paniek vandag",
  sinceMidnight: "sedert middernag",
  loggedToday: "Vandag aangeteken",
  occurrencesToday: "voorvalle vandag",
  closedToday: "Vandag gesluit",
  noLongerLive: "nie meer lewendig nie",
  siteMonitor: "Terreinmonitor",
  team: "Span",
  fleet: "Vloot",
  member: "Lid",
  lastActivity: "Laaste aktiwiteit",
  viewFleet: "Sien vloot",
  moving: "Ry",
  idle: "Stil",
  offline: "Af",
  noTeamInGroup: "Geen spanlede in hierdie groep nie.",
  noTeamOnSite: "Geen span aan hierdie terrein toegewys nie.",
  noTrackersInGroup: "Geen GPS-spoorders in hierdie groep nie.",
  noVehiclesOnSite: "Geen voertuie aan hierdie terrein gekoppel nie.",
  liveNow: "Lewendig nou",
  idleLong: "4 u+ stil",
  live: "Lewendig",
  off: "Af",
  signal: "Sein",
  gps: "GPS",
  liveIncidents: "Lewendige voorvalle",
  activeCount: (n) => `${n} aktief`,
  allClear: "Alles veilig",
  mapHint: "Terreine, span-GPS en vloot op die kaart",
  locationPending: "Ligging hangende",
  incident: "Voorval",
  viewAttachments: (subject) => `Sien aanhegsels vir ${subject}`,
  todaysOccurrences: "Vandag se voorvalle",
  fullBook: "Volle boek →",
  emptyToday: "Nog geen voorvalle vandag aangeteken nie.",
  thisWeek: "Hierdie week",
  showAll: "Al drie",
  whiteBackground: "Wit",
  darkBackground: "Donker",
  viewWeek: "Sien week →",
  emptyWeek: "Geen ander voorvalle hierdie week nie.",
  uncategorised: "Ongesorteer",
  unknownReporter: "Onbekende verslaggewer",
  logged: "Aangeteken",
  occurred: "Gebeur",
  book: "Boek →",
  fromPanic: "Van 'n paniekwaarskuwing",
  hasAttachments: "Het aanhegsels",
  responding: "Reageer",
  available: "Beskikbaar",
  offDuty: "Af diens",
  role: (role) => {
    const mapped: Record<string, string> = {
      administrator: "Administrateur",
      control_room: "Beheerkamer",
      supervisor: "Toesighouer",
      reporter: "Verslaggewer",
      access_controller: "Toegangsbeheer",
      patrol_user: "Patrollie",
    };
    return mapped[role] ?? titleCaseRole(role);
  },
  lastLocation: "Laaste / huidige ligging",
  unknownTime: "Onbekende tyd",
  openInMaps: "Maak in Maps oop",
  copyCoordinates: "Kopieer koördinate",
  coordinatesCopied: "Koördinate gekopieer",
  couldNotCopy: "Kon nie kopieer nie",
  noGpsForMember: "Nog geen GPS-posisie vir hierdie lid nie.",
  openLiveIncident: "Maak lewendige voorval oop",
  noGpsYet: "Nog geen GPS",
  noGpsDescription: (name) => `${name} het nog geen ligging om op die kaart te wys nie.`,
  attachments: "Aanhegsels",
  nav: {
    activeGroup: "Aktiewe groep",
    selectGroup: "Kies 'n groep",
    requestAccess: "Vra toegang tot 'n ander groep →",
    navigation: "Navigasie",
    dashboard: "Beheerkamer",
    occurrenceBook: "Voorvalleboek",
    accessControl: "Toegangsbeheer",
    patrol: "Patrollie",
    siteSurvey: "Terreinopname",
    analytics: "Ontleding",
    liveIncident: "Lewendige voorval",
    assets: "Bates",
    cameras: "Kameras",
    admin: "Administrasie",
    users: "Gebruikers",
    sites: "Terreine",
    fieldSetup: "Veldopstelling",
    importData: "Voer data in",
    groups: "Groepe",
    chat: "Boodskappe",
    notifications: "Kennisgewings",
    enableNotifications: "Skakel kennisgewings aan",
    notificationsBlocked: "Geblokkeer deur die blaaier. Maak werfinstellings oop, laat kennisgewings toe, en probeer weer.",
    signOut: "Teken uit",
    privacy: "Privaatheidsbeleid",
    poweredBy: "aangedryf deur",
  },
  screen: {
    incident: "Voorval",
    incidents: "Voorvalle",
    hotspot: "Brandpunt",
    leadType: "Hoofsoort",
    peakHour: "Spitsuur",
    noIncidentsPeriod: "Geen voorvalle in hierdie tydperk nie. Verander die datums of maak die filters skoon.",
    to: "tot",
    clear: "Maak skoon",
    charts: "Grafieke",
    map: "Kaart",
    total: "Totaal",
    topLocation: "Top ligging",
    topType: "Top soort",
    allDates: "Alle datums",
    filteringBy: "Filtreer volgens:",
    clearAll: "Maak alles skoon",
    location: "Ligging",
    type: "Soort",
    incidentTime: "Voorvaltyd",
    incidentDate: "Voorvaldatum",
    dayOfWeek: "Dag van die week",
    analyticsMap: "Ontleding · Kaart",
    myIncidents: "My voorvalle",
    thisWeek: "Hierdie week",
    today: "Vandag",
    allRecords: "Alle rekords",
    inView: "In sig",
    noIncidentsView: "Geen voorvalle in hierdie aansig nie. Verander die filters of teken 'n nuwe voorval aan.",
    overview: "Oorsig",
    gateDesk: "Hek",
    onSite: "Op terrein",
    destinations: "Bestemmings",
    noDestinations: "Nog geen aktiewe bestemmings nie.",
    manager: "Bestuurder",
    field: "Veld",
    route: "Roete",
    routes: "Roetes",
    noRoutesYet: "Nog geen roetes nie. Voeg 'n roete by om te begin.",
    noPatrolAssigned: "Nog geen patrollieroetes toegeken nie.",
    security: "Sekuriteit",
    siteSurveyTitle: "Terreinopnames",
    siteSurveyBody: "Doen gestruktureerde terreinlyste, neem bewyse met GPS, en deel PDF-verslae.",
    standby: "Gereed",
    autoRefresh: "Verfris elke 5s",
    active: "Aktief",
    status: "Status",
    liveResponse: "Lewendige reaksie aan die gang",
    vehicle: "Voertuig",
    vehicles: "Voertuie",
    vehicleDetail: "Voertuigbesonderhede",
    fleetBoard: "Vlootbord",
    addVehicle: "Voeg voertuig by",
    asset: "Bate",
    assetsWord: "Bates",
    assetRegister: "Bateregister",
    addAsset: "Voeg bate by",
    camera: "kamera opgestel",
    camerasConfigured: "kameras opgestel",
    addCamera: "Voeg kamera by",
    noCameras: "Nog geen kameras nie. Voeg die eerste bron by om te monitor.",
    last7Days: "Laaste 7 dae",
    unread: "Ongelees",
    noNotifications: "Geen kennisgewings in die laaste 7 dae nie.",
    user: "Gebruiker",
    usersWord: "Gebruikers",
    addUser: "Voeg gebruiker by",
    site: "Terrein",
    sitesWord: "Terreine",
    addPosition: "Voeg posisie by",
    positions: "Posisies",
    enrolled: "Ingeskryf",
    pending: "Hangende",
    admin: "Admin",
    configured: "Opgestel",
    formFields: "Vormvelde",
    types: "Soorte",
    locations: "Liggings",
    occurrenceImport: "Voorval-invoer",
    rows: "Rye",
    newGroup: "Nuwe groep",
    group: "Groep",
    groupsWord: "Groepe",
    custom: "Eie",
    members: "Lede",
  },
};

function titleCaseRole(role: string): string {
  return role
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function controlRoomCopy(lang: ControlRoomLang): ControlRoomCopy {
  return lang === "af" ? af : en;
}
