# TrackSOS Shop — catalog, fleet purchases and low-data mode

## Release lock (do not change)

- `settings.shop.enabled` stays **false** in production until the owner explicitly approves opening.
- The existing public text `shop.closedTitle` / `shop.closedText` remains unchanged; the disabled storefront cannot place an order.
- This feature can be built and deployed without enabling the shop. Do **not** switch it on during rollout or testing outside dedicated test databases.
- Order history remains readable when the storefront is closed.

## Customer experience

- Three navigation routes: part name/article/brand, visible categories, and (later, after license) VIN + assembly-level fitment.
- Every purchase may optionally link to a vehicle registered in the customer's Garage; only its owner or assigned driver may link it.
- Order line snapshots retain the part name/brand/article and the paid price; old orders remain readable even if the product is later hidden.
- From history, repeat the purchased line or open **verified** catalog cross-references.
- Do not label an analog **fits this VIN** based solely on a cross-reference. Current response carries `compatibilityConfirmed: false`.
- When the store is closed, the reorder/analogs controls are hidden; history remains visible.

## Data layers

1. **Packaged app/UI**: static shell and categories; optional **licensed** compact name+article packs can later be bundled into `web/public/` so APK builds include them. No supplier database has been bundled yet.
2. **IndexedDB (browser/WebView)**: text-only product index (ID, category, brand, article, name, search synonyms). Customer deliberately downloads up to 3,000 records per action, with cursor-resume and revision checks. Low-data mode does not silently fetch hundreds of thousands of records.
3. **Online API**: fresh prices, inventory, delivery lead times, checkout permissions, order status, VIN fitment validation and supplier orders. No stale cache checkout.
4. **Supplier adapter**: Autokontinent remains a planned server-side integration. API credentials and commercial price lists must never be shipped to WebView or browsers. Supplier permissions/data feed are pending.

## API contract

- `GET /api/shop?light=1` — settings + up to eight featured kits, no unbounded product list.
- `GET /api/shop/search?q=...&category=...&page=...&limit=24` — 24 items by default, max 48, live prices; disabled shop returns no items.
- `GET /api/shop/selection?ids=id,id` — up to 50 active cart products; fresh prices.
- `GET /api/shop/index/manifest` — catalog revision, count and enable state.
- `GET /api/shop/index/page?after=UUID&limit=750` — max 1000 **text-only** rows [id, category, brand, article, name, synonyms], cursor by UUID, no prices or private fields.
- `GET /api/shop/index/changes?after=SEQ&limit=750` — increments only; rows [sequence, id, category, brand, article, name, synonyms], or [sequence, id] to delete obsolete articles. A bounded sequence cursor and server revision prevent missed changes during sync.
- `GET /api/shop/history?vehicleId=UUID&page=0` — 20 orders per page, owner/driver scope preserved.
- `GET /api/shop/products/:id/analogs` — only admin-verified analog links; no VIN applicability claim.
- `POST /api/admin/shop/products/:id/analogs` — admin curates a linked in-catalog analog and cites evidence; links remain hidden until verified.

The old `GET /api/shop` and `GET /api/shop/orders` endpoints are retained for older APK versions.

## Next data steps

- Obtain a licensed cross-reference and VIN-fitment source covering heavy trucks, trailers, axle brands and brake systems. Vehicle VIN alone may not identify replacement axles, engines and brakes.
- Validate Autokontinent credentials/API terms, update cadence and reserve/checkout behavior. Add supplier SKU to catalog mapping only after permission.
- Import legally licensed external catalog data in **small, versioned category/manufacturer packs**; measure network payload sizes and APK growth before bundling. Updates use a database change journal and tombstones, not full downloads. 
- A text-only index can grow large; keep it separate from the APK until licensed data and mobile-size measurements justify shipping a specific bounded starter pack.
- Group browsing by heavy truck systems, trailer components and universal roadside parts, preserving all old category keys.
- The supplier SKU mapping and actual Autokontinent sync still require documented API access, terms and credentials. Never expose them in the mobile bundle.
- Add safe offline search indexes for million-row catalogs instead of scanning IDB cursors; current IDB cursor scan bounds memory but is intended for modest initial catalogs.
- Test older Android APK compatibility, poor mobile connections, migrations on existing databases, photo placeholders and every click before release.
