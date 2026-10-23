# M8 checklist: no admin feature lost

Generated at the start of M8 from the admin routes (`AdminApp.tsx`), the Settings groups
(`SettingsPage.tsx`) and the API calls each page imports from `lib/adminApi` / `lib/api`
(implementation plan §7, "Admin rebuild drops a feature"). A page is ticked when it is on
`PageTemplate`, every call below is still made, and its old CSS is deleted. Screens pages
(walls, displays, presence, games) and the Wall Editor move in M9; setup and sign-in in M10.

## Taps & kegs

- [x] `/admin/taps` — `TapsPage`: getMenu, listBeers, listKegs, listMonitors, listTaps,
  getActiveKegStats, getCleaningStatuses, logTapCleaning, setCleaningReminders, deleteTap
  - [x] `TapForm` (now in a drawer): createTap, updateTap, getDrinkers
  - [x] `SwapWizard` (now a drawer): swapTap, listSuppliers, resetKegtronVolume
  - [x] `OnDeckQueue`: listOnDeck, createKeg, removeOnDeckKeg
  - [x] `KickedHistory`: listKegs
  - [x] `BeerPicker`: importKegtronBeer
- [x] `/admin/kegs` — `KegsPage`: listKegHistory, listSuppliers, updateKeg
- [x] `/admin/suppliers` — `SuppliersPage`: listSuppliers, getSupplierStats,
  getSupplierPriceBook, createSupplier, updateSupplier, deleteSupplier (+ `SupplierHoursEditor`)
- [x] `/admin/monitors` — `MonitorsPage`: getMenu, listMonitors, bindMonitor,
  getMonitorTelemetry, getMonitorWifiRssi, resetKegtronVolume, updateMonitorIdentity

## Beers

- [x] `/admin/beers` — `BeersPage`: listBeers, listKegs, getMenu, deleteBeer, getLookupConfig
  - [x] `BeerForm`: createBeer, updateBeer, uploadLabel, lookupBeers
  - [x] `BeerSearchSheet`: lookupBeers; `BreweryAutocomplete`: lookupBreweries; `StyleAutocomplete`

## People

- [x] `/admin/people` — `PeoplePage`: getPourers, listUsers, getFaceCounts
- [x] `/admin/pourers` — `PourersPage`: getPourers, getLeaderboard
- [x] `/admin/users` — `UsersPage`: listUsers, createLoginUser, createDrinkerProfile,
  updateUser, deleteUser, getFaceCounts, deleteFacesAdmin (forms split into `people/UserForms.tsx`)

## Insights

- [x] `/admin/stats` — `StatsPage`: getAnalyticsKpis, getPoursByDay, getPourHistory,
  getBeerHistory, getBeersByVolume, getHourHistogram, getHourHeatmap, getActiveKegStats,
  getKegCosts, getMonthlySpend, getLeaderboard, getPourerHistory, getStatsTemps, getSensors,
  getHostStatsHistory, getSources, listMonitors, doctorUdpHistory (issue 16: "—", never 0; split into `insights/`)
- [x] `/admin/pours` — `PoursPage`: listRecentPours, getDrinkers, listBeers, listKegs,
  listTaps, setPourDrinker, setPoursDrinker
- [x] `/admin/logs` — `LogsPage`: getLogs

## Settings

- [ ] `/admin/settings` — `SettingsPage`: getSettings, and its groups: Site (uploadLabel),
  Pricing, Kegtron, Sources, Integrations, Channels (testChannel), System (checkForUpdates,
  getSystemVersion, pollSystemVersion, pollUpdateStatus, triggerUpdate, triggerOsUpdate,
  triggerKioskRestart, testPour), `BackupPanel` (uploadRestore)
- [ ] `/admin/automations` — `AutomationsPage`: listAutomations, listAutomationTemplates,
  createFromTemplate, updateAutomation, deleteAutomation
  - [ ] `AutomationBuilder`: createAutomation, updateAutomation, runAutomation,
    listAutomationChannels, listBeers, listTaps
- [ ] `/admin/home-assistant` — `HomeAssistantPage`: getSettings (+ `HaSetupWizard`)
- [ ] `/admin/doctor` — `DoctorPage`: getSources, doctorCloud, doctorEnv, doctorGovee,
  doctorListen, doctorUdpHistory, doctorUdpRaw
- [ ] `/admin/notifications` — `NotificationsPage`: listNotifications, ackNotification,
  ackAllNotifications

## Already V2 (M7)

- [x] `/admin` — `TonightPage`; the shell (`AdminLayout`, `NotificationBell`, `CommandPalette`)
