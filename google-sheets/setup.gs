/**
 * =====================================================================
 *  NUTEX WHOLESALE - Google Sheets database setup (Google Apps Script)
 * =====================================================================
 *  GENERATED from server/config/schema.js (schema v9).
 *  Do not edit by hand - run "npm run gs:generate" after schema changes.
 *
 *  HOW TO USE
 *   1. Open your Google Sheet -> Extensions -> Apps Script.
 *   2. Delete any code in Code.gs, paste this whole file, click Save.
 *   3. Select the function "setupNutexSheets" and click Run.
 *      (First time: Review permissions -> choose your account -> Allow.)
 *   4. Reload the spreadsheet: a "Nutex Setup" menu appears for next time.
 *
 *  SAFE TO RUN ANY NUMBER OF TIMES - ADDITIVE ONLY
 *   - creates only MISSING sheets, adds only MISSING columns (at the end),
 *     adds only MISSING settings, records schema versions;
 *   - never deletes, clears, reorders or overwrites any existing data.
 *  The website also performs this same additive check every time it starts.
 * =====================================================================
 */

var NUTEX_SCHEMA_VERSION = 9;
var NUTEX_SPREADSHEET_NAME = 'NUTEX WHOLESALE DATABASE';

/** Sheet name -> header row (column A is always the record's stable ID). */
var NUTEX_SCHEMA = {
  "Settings": ["setting_key","setting_value","data_type","description","updated_at","updated_by"],
  "Categories": ["category_id","category_name","parent_category","slug","description","image_file_id","image_url","status","sort_order","seo_title","seo_description","created_at","updated_at"],
  "Colors": ["color_id","color_name","color_code","hex_code","swatch_image","status","sort_order","created_at","updated_at"],
  "Sizes": ["size_id","size_name","sort_order","status","created_at","updated_at"],
  "Products": ["product_id","sku","product_name","slug","category_id","subcategory","description","mrp","discount_mode","fixed_discount_percent","inventory_mode","size_ids","color_ids","status","out_of_stock","featured","sort_order","seo_title","seo_description","created_at","updated_at","created_by","updated_by","sell_mode","units_per_box","pcs_for_new_customers"],
  "Product_Images": ["image_id","product_id","drive_file_id","file_url","image_type","alt_text","sort_order","status","created_at","updated_at"],
  "Product_Variants": ["variant_id","product_id","sku","size_id","color_id","box_id","inventory_mode","units_per_box","box_mrp","mixed_color_description","status","sort_order","created_at","updated_at","variant_mrp"],
  "Inventory": ["inventory_id","variant_id","product_id","color_id","size_id","box_id","stock_qty","reserved_qty","available_qty","status","updated_at","updated_by"],
  "Discount_Slabs": ["slab_id","label","min_amount","max_amount","discount_percent","priority","active","start_date","end_date","deleted","created_at","updated_at"],
  "Existing_Customers": ["mobile","customer_name","business_name","city","gstin","minimum_order_value","status","notes","added_at","updated_at","added_by","alternate_mobiles"],
  "Customers": ["customer_id","customer_name","business_name","mobile","whatsapp","email","billing_address","shipping_address","city","state","pincode","gstin","created_at","updated_at","alternate_mobile"],
  "Orders": ["order_id","order_number","customer_id","customer_name_snapshot","business_name_snapshot","mobile_snapshot","whatsapp_snapshot","email_snapshot","billing_address_snapshot","shipping_address_snapshot","city_snapshot","state_snapshot","pincode_snapshot","gstin_snapshot","order_notes","mrp_subtotal","discount_mode_snapshot","discount_basis_snapshot","discount_basis_amount","discount_percent","slab_id_snapshot","discount_amount","final_payable","total_qty","minimum_order_value_snapshot","minimum_order_met","order_status","payment_status","locked","stock_state","revision","idempotency_key","courier_name","tracking_number","dispatch_note","cancel_reason","created_at","updated_at","locked_at","payment_submitted_at","verified_at","dispatched_at","completed_at","cancelled_at","customer_type_snapshot","alternate_mobile_snapshot","payment_mode_snapshot","packing_deduction"],
  "Order_Items": ["order_item_id","order_id","order_number","revision","product_id","variant_id","sku_snapshot","product_name_snapshot","category_snapshot","inventory_mode_snapshot","size_snapshot","color_snapshot","box_snapshot","units_per_box_snapshot","qty","mrp_unit_snapshot","discount_percent_snapshot","wholesale_unit_snapshot","line_mrp_total","line_total","status","created_at","stock_components"],
  "Payments": ["payment_id","order_id","order_number","amount","expected_amount","payment_method","utr","proof_file_id","proof_url","status","idempotency_key","customer_note","submitted_at","verified_at","verified_by","remarks"],
  "Order_Status_History": ["history_id","order_id","order_number","from_status","to_status","actor_type","actor_id","note","created_at"],
  "Admin_Users": ["admin_id","email","name","password_hash","role","status","session_version","last_login_at","created_at","updated_at"],
  "Audit_Log": ["audit_id","timestamp","admin_id","actor_type","action","entity_type","entity_id","old_value","new_value","reason","notes","ip"],
  "Schema_Version": ["version","applied_at","description","app_version"]
};

var NUTEX_TEXT_COLUMNS = {
  "Existing_Customers": ["mobile","alternate_mobiles","gstin"],
  "Customers": ["mobile","whatsapp","pincode","gstin","alternate_mobile"],
  "Orders": ["order_number","mobile_snapshot","whatsapp_snapshot","pincode_snapshot","gstin_snapshot","alternate_mobile_snapshot"],
  "Payments": ["utr","order_number"],
  "Settings": ["setting_value"]
};

var NUTEX_DROPDOWNS = {
  "Existing_Customers": {"status":["ACTIVE","INACTIVE"]},
  "Categories": {"status":["ACTIVE","INACTIVE","ARCHIVED"]},
  "Colors": {"status":["ACTIVE","INACTIVE","ARCHIVED"]},
  "Sizes": {"status":["ACTIVE","INACTIVE","ARCHIVED"]},
  "Products": {"status":["ACTIVE","INACTIVE","ARCHIVED"],"inventory_mode":["COLOR_WISE","BOX_WISE"],"discount_mode":["GLOBAL","CUSTOM"]},
  "Inventory": {"status":["ACTIVE","OUT_OF_STOCK"]}
};

/** [setting_key, default value, data_type, description] - added only if missing. */
var NUTEX_DEFAULT_SETTINGS = [
  ["company_name","Nutex Apparel Limited","string","Company name shown across the website"],
  ["company_tagline","Wholesale innerwear & lingerie","string","Short tagline under the logo"],
  ["company_logo_file_id","","string","Google Drive file ID of the company logo"],
  ["size_chart_file_id","","string","Google Drive file ID of the bra size chart shown on product pages"],
  ["company_phone","","string","Customer care phone number"],
  ["company_email","","string","Customer care email"],
  ["company_address","","text","Registered / business address"],
  ["company_gstin","","string","Company GSTIN (shown on legal pages)"],
  ["bill_title","ESTIMATE","string","Heading printed on the order bill PDF"],
  ["bill_terms","1. All Order Are Subject To Dealer's Confirmation.\n2. Order Once Given Will Not Be Cancelled.\n3. In Case Of Dispute Company's Decision Is Final And Binding To All Parties.\n4. All Dispute Subject To Delhi Jurisdiction.","text","Terms & Conditions printed on the order bill PDF (one per line)"],
  ["whatsapp_number","","phone","Support WhatsApp number with country code, e.g. 919876543210"],
  ["business_hours","Mon-Sat, 10:00 AM - 7:00 PM","string","Business hours shown on contact page"],
  ["jurisdiction_city","","string","City for legal jurisdiction in Terms & Conditions"],
  ["support_message","For wholesale enquiries, message us on WhatsApp. Our team will help you choose products and sizes.","text","Support message shown on the website"],
  ["announcement_text","","string","Optional announcement bar text (blank = automatic minimum-order message)"],
  ["hero_title","Wholesale innerwear, direct from Nutex","string","Homepage headline"],
  ["hero_subtitle","Bras, panties, lingerie sets, camisoles and men's innerwear at wholesale prices for retailers and resellers.","text","Homepage sub-headline"],
  ["minimum_order_value",10000,"number","Minimum FINAL payable (after discount) required to place an order"],
  ["discount_mode","FIXED","enum","FIXED = single discount %, SLAB = tiered discount slabs"],
  ["default_discount_percent",60,"number","Fixed wholesale discount % (also the base for PRE_DISCOUNT_WHOLESALE_SUBTOTAL slab basis)"],
  ["discount_slab_basis","MRP_SUBTOTAL","enum","Which cart amount selects the slab"],
  ["price_display_mode","SHOW_BOTH","enum","Prices shown on product cards/pages"],
  ["currency","INR","string","Currency code"],
  ["order_prefix","NX","string","Prefix of customer-facing order numbers, e.g. NX-20261003-0001"],
  ["low_stock_threshold",5,"number","Variants at or below this available quantity are flagged as low stock"],
  ["reservation_expiry_hours",72,"number","Unpaid orders (no payment submitted) are auto-cancelled after this many hours and their stock released. 0 = never."],
  ["existing_customer_minimum_order_value",0,"number","Minimum order for verified existing customers (0 = no minimum). A value in the Existing_Customers sheet overrides this per customer."],
  ["existing_customer_otp_enabled",true,"boolean","Verify existing customers with a WhatsApp OTP (recommended). If off, the mobile number alone is enough."],
  ["pcs_for_existing_customers_only",true,"boolean","TRUE = new customers buy full boxes; loose pieces only where the product allows it (Products > pieces for new customers). FALSE = loose pieces for everyone on every product. Existing customers always choose box or pieces."],
  ["auto_existing_after_first_order",true,"boolean","When the first payment of a new customer is verified, add their mobile to Existing_Customers automatically (pieces allowed and no minimum order from then on)."],
  ["otp_message_template","{{otp}} is your {{company_name}} verification code. It is valid for 5 minutes. Do not share this code with anyone.","text","WhatsApp OTP message. {{otp}} and {{company_name}} are replaced automatically."],
  ["payment_qr_file_id","","string","Google Drive file ID of the payment QR uploaded by admin"],
  ["upi_id","","string","Company UPI ID"],
  ["payment_name","","string","Account / payee name shown with the QR"],
  ["payment_instructions","1. Scan the QR code with any UPI app (GPay, PhonePe, Paytm, BHIM).\n2. Pay the exact order amount.\n3. Note the UTR / Transaction ID.\n4. Submit the UTR and payment screenshot below.","text","Instructions shown on the payment page"],
  ["online_payment_enabled",true,"boolean","ON = after checkout the customer pays by the UPI QR. OFF = checkout ends on a thank-you page and the team confirms each order (payment collected outside the website)."],
  ["payment_whatsapp_number","","phone","WhatsApp number for payment confirmation (falls back to support number)"],
  ["legal_privacy_policy","","text","Privacy Policy (blank = default template)"],
  ["legal_terms","","text","Terms & Conditions (blank = default template)"],
  ["legal_wholesale_terms","","text","Wholesale Terms (blank = default template)"],
  ["legal_shipping_policy","","text","Shipping Policy (blank = default template)"],
  ["legal_cancellation_policy","","text","Cancellation Policy (blank = default template)"],
  ["legal_refund_policy","","text","Refund / Return Policy (blank = default template)"]
];

var NUTEX_MIGRATIONS = [
  [1,"Initial Nutex wholesale schema (16 sheets + Order_Status_History)"],
  [2,"Existing customers list (minimum order exemption)"],
  [3,"Alternate mobile numbers for customers"],
  [4,"Size-wise MRP and size chart"],
  [5,"Box / pieces selling per product"],
  [6,"Loose pieces for new customers per product"],
  [7,"Boxes packed from loose colour stock"],
  [8,"Online payment on/off (thank-you page, team confirms orders)"],
  [9,"Less: packing charges (admin deduction per order)"]
];

var NUTEX_MASTER_DATA = {
  "categories": [{"category_name":"Set / Lingerie Set","parent_category":"WOMEN","slug":"lingerie-set"},{"category_name":"Padded Bra","parent_category":"WOMEN","slug":"padded-bra"},{"category_name":"Sports Bra","parent_category":"WOMEN","slug":"sports-bra"},{"category_name":"T-Shirt Bra","parent_category":"WOMEN","slug":"t-shirt-bra"},{"category_name":"Everyday Bra Collection","parent_category":"WOMEN","slug":"everyday-bra"},{"category_name":"Print Collection","parent_category":"WOMEN","slug":"print-collection"},{"category_name":"Cotton Collection","parent_category":"WOMEN","slug":"cotton-collection"},{"category_name":"Camisole Collection","parent_category":"WOMEN","slug":"camisole-collection"},{"category_name":"Everyday Panty Collection","parent_category":"PANTIES","slug":"everyday-panty"},{"category_name":"Men Collection","parent_category":"MEN","slug":"men-collection"}],
  "sizes": ["28","30","32","34","36","38","40","42","44","46","48","50","52","54","56","Free Size"],
  "colors": [{"color_name":"Black","color_code":"BLK","hex_code":"#111111"},{"color_name":"White","color_code":"WHT","hex_code":"#FFFFFF"},{"color_name":"Skin","color_code":"SKN","hex_code":"#E8C4A8"},{"color_name":"Pink","color_code":"PNK","hex_code":"#F4A7B9"},{"color_name":"Red","color_code":"RED","hex_code":"#C62828"},{"color_name":"Maroon","color_code":"MRN","hex_code":"#6D1B2E"},{"color_name":"Navy Blue","color_code":"NVY","hex_code":"#1F2A56"},{"color_name":"Grey","color_code":"GRY","hex_code":"#9AA0A6"}]
};

/* ------------------------------------------------------------------ menu */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Nutex Setup')
    .addItem('1. Create / update all sheets', 'setupNutexSheets')
    .addItem('2. Load initial categories, sizes and colours', 'loadNutexMasterData')
    .addItem('3. Check setup', 'checkNutexSetup')
    .addToUi();
}

/* ------------------------------------------------------- 1. setup sheets */
function setupNutexSheets() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var report = { created: [], columns: [], settings: 0, versions: [], warnings: [] };

    if (/^Untitled/i.test(ss.getName())) {
      ss.rename(NUTEX_SPREADSHEET_NAME);
      report.renamed = NUTEX_SPREADSHEET_NAME;
    }

    Object.keys(NUTEX_SCHEMA).forEach(function (name) {
      nutexEnsureSheet_(ss, name, NUTEX_SCHEMA[name], report);
    });

    report.settings = nutexEnsureSettings_(ss);
    report.versions = nutexEnsureVersions_(ss);

    var unused = ss.getSheets().filter(function (s) {
      return s.getName() === 'Sheet1' && s.getLastRow() === 0 && s.getLastColumn() === 0;
    });
    if (unused.length) report.warnings.push('The empty default tab "Sheet1" is not used by the app - you may delete it yourself.');

    var lines = [];
    if (report.renamed) lines.push('Spreadsheet renamed to "' + report.renamed + '".');
    lines.push('Sheets created: ' + (report.created.length ? report.created.join(', ') : 'none (all present)'));
    lines.push('Columns added: ' + (report.columns.length ? report.columns.join('; ') : 'none'));
    lines.push('Settings added: ' + report.settings);
    lines.push('Schema versions recorded: ' + (report.versions.length ? report.versions.join(', ') : 'already up to date (v' + NUTEX_SCHEMA_VERSION + ')'));
    report.warnings.forEach(function (w) { lines.push('WARNING: ' + w); });
    lines.push('');
    lines.push('Next: share this sheet (Editor) with the service-account email, then run "Check setup".');
    nutexNotify_('Nutex sheets ready', lines);
    return report;
  } finally {
    lock.releaseLock();
  }
}

function nutexEnsureSheet_(ss, name, columns, report) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    nutexStyleHeader_(sheet, 1, columns.length);
    nutexFormatColumns_(sheet, name, columns, 1);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, columns.length);
    report.created.push(name);
    return sheet;
  }

  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  while (header.length && !header[header.length - 1]) header.pop();

  if (!header.length) {
    if (sheet.getLastRow() > 1) {
      report.warnings.push('Sheet "' + name + '" has data but no header row - NOT modified. Add the header row manually.');
      return sheet;
    }
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    nutexStyleHeader_(sheet, 1, columns.length);
    nutexFormatColumns_(sheet, name, columns, 1);
    sheet.setFrozenRows(1);
    report.columns.push(name + ': header row written');
    return sheet;
  }

  var missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length) {
    var start = header.length + 1;
    var needed = start + missing.length - 1;
    if (sheet.getMaxColumns() < needed) sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
    sheet.getRange(1, start, 1, missing.length).setValues([missing]);
    nutexStyleHeader_(sheet, start, missing.length);
    nutexFormatColumns_(sheet, name, missing, start);
    report.columns.push(name + ': ' + missing.join(', '));
  }
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  return sheet;
}

function nutexStyleHeader_(sheet, startCol, count) {
  sheet.getRange(1, startCol, 1, count)
    .setFontWeight('bold')
    .setBackground('#5b1638')
    .setFontColor('#ffffff');
}

/** Text format + dropdowns for NEW columns only (existing values are never changed). */
function nutexFormatColumns_(sheet, name, columns, startCol) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  var textCols = NUTEX_TEXT_COLUMNS[name] || [];
  var dropdowns = NUTEX_DROPDOWNS[name] || {};
  columns.forEach(function (col, i) {
    var range = sheet.getRange(2, startCol + i, rows, 1);
    if (textCols.indexOf(col) !== -1) range.setNumberFormat('@');
    if (dropdowns[col]) {
      range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(dropdowns[col], true).setAllowInvalid(true).build());
    }
  });
}

function nutexHeaderMap_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  return header;
}

/** Appends objects AFTER the last row, mapped by header name. Never overwrites. */
function nutexAppendObjects_(sheet, objects) {
  if (!objects.length) return;
  var header = nutexHeaderMap_(sheet);
  var rows = objects.map(function (o) {
    return header.map(function (h) { return Object.prototype.hasOwnProperty.call(o, h) ? o[h] : ''; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
}

function nutexColumnValues_(sheet, columnName) {
  var header = nutexHeaderMap_(sheet);
  var idx = header.indexOf(columnName);
  if (idx === -1 || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, idx + 1, sheet.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
}

function nutexEnsureSettings_(ss) {
  var sheet = ss.getSheetByName('Settings');
  var present = nutexColumnValues_(sheet, 'setting_key');
  var now = new Date().toISOString();
  var rows = NUTEX_DEFAULT_SETTINGS
    .filter(function (s) { return present.indexOf(s[0]) === -1; })
    .map(function (s) {
      return { setting_key: s[0], setting_value: s[1], data_type: s[2], description: s[3], updated_at: now, updated_by: 'SETUP_SCRIPT' };
    });
  nutexAppendObjects_(sheet, rows);
  return rows.length;
}

function nutexEnsureVersions_(ss) {
  var sheet = ss.getSheetByName('Schema_Version');
  var present = nutexColumnValues_(sheet, 'version').map(Number);
  var now = new Date().toISOString();
  var added = [];
  var rows = NUTEX_MIGRATIONS
    .filter(function (m) { return present.indexOf(m[0]) === -1; })
    .map(function (m) {
      added.push('v' + m[0]);
      return { version: m[0], applied_at: now, description: m[1], app_version: 'apps-script' };
    });
  nutexAppendObjects_(sheet, rows);
  return added;
}

/* ---------------------------------------------- 2. initial master data */
function loadNutexMasterData() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    setupNutexSheetsQuiet_(ss);
    var now = new Date().toISOString();
    var lines = [];

    var cats = ss.getSheetByName('Categories');
    if (cats.getLastRow() < 2) {
      nutexAppendObjects_(cats, NUTEX_MASTER_DATA.categories.map(function (c, i) {
        return {
          category_id: nutexNewId_('CAT'), category_name: c.category_name, parent_category: c.parent_category, slug: c.slug,
          status: 'ACTIVE', sort_order: (i + 1) * 10, created_at: now, updated_at: now,
        };
      }));
      lines.push('Categories: ' + NUTEX_MASTER_DATA.categories.length + ' added');
    } else lines.push('Categories: skipped (sheet already has data)');

    var sizes = ss.getSheetByName('Sizes');
    if (sizes.getLastRow() < 2) {
      nutexAppendObjects_(sizes, NUTEX_MASTER_DATA.sizes.map(function (s, i) {
        return { size_id: nutexNewId_('SIZ'), size_name: s, sort_order: (i + 1) * 10, status: 'ACTIVE', created_at: now, updated_at: now };
      }));
      lines.push('Sizes: ' + NUTEX_MASTER_DATA.sizes.length + ' added');
    } else lines.push('Sizes: skipped (sheet already has data)');

    var colors = ss.getSheetByName('Colors');
    if (colors.getLastRow() < 2) {
      nutexAppendObjects_(colors, NUTEX_MASTER_DATA.colors.map(function (c, i) {
        return {
          color_id: nutexNewId_('CLR'), color_name: c.color_name, color_code: c.color_code, hex_code: c.hex_code,
          status: 'ACTIVE', sort_order: (i + 1) * 10, created_at: now, updated_at: now,
        };
      }));
      lines.push('Colours: ' + NUTEX_MASTER_DATA.colors.length + ' added');
    } else lines.push('Colours: skipped (sheet already has data)');

    nutexNotify_('Initial master data', lines);
  } finally {
    lock.releaseLock();
  }
}

function setupNutexSheetsQuiet_(ss) {
  var report = { created: [], columns: [], warnings: [] };
  Object.keys(NUTEX_SCHEMA).forEach(function (name) { nutexEnsureSheet_(ss, name, NUTEX_SCHEMA[name], report); });
  nutexEnsureSettings_(ss);
  nutexEnsureVersions_(ss);
}

/** Stable, immutable IDs in the same format the website uses: PREFIX-<time36><random hex>. */
function nutexNewId_(prefix) {
  var time = Date.now().toString(36).toUpperCase();
  while (time.length < 9) time = '0' + time;
  var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
  Utilities.sleep(2);
  return prefix + '-' + time + rand;
}

/* ------------------------------------------------------- 3. check setup */
function checkNutexSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];
  var ok = true;
  Object.keys(NUTEX_SCHEMA).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      ok = false;
      lines.push('MISSING sheet: ' + name);
      return;
    }
    var header = nutexHeaderMap_(sheet);
    var missing = NUTEX_SCHEMA[name].filter(function (c) { return header.indexOf(c) === -1; });
    if (missing.length) {
      ok = false;
      lines.push(name + ': missing columns ' + missing.join(', '));
    } else {
      lines.push(name + ': OK (' + Math.max(sheet.getLastRow() - 1, 0) + ' rows)');
    }
  });
  var editors = ss.getEditors().map(function (u) { return u.getEmail(); });
  var sa = editors.filter(function (e) { return /gserviceaccount\.com$/i.test(e); });
  lines.push('');
  lines.push(sa.length ? 'Service account has Editor access: ' + sa.join(', ') : 'WARNING: no service account is an Editor yet - share the sheet with the GOOGLE_SERVICE_ACCOUNT_EMAIL.');
  lines.push(ok ? 'All sheets and columns are present.' : 'Run "1. Create / update all sheets" to add what is missing.');
  nutexNotify_('Nutex setup check', lines);
}

/* ---------------------------------------------------------------- utils */
function nutexNotify_(title, lines) {
  Logger.log(title + '\n' + lines.join('\n'));
  try {
    SpreadsheetApp.getUi().alert(title, lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Run from the script editor without a UI - see Execution log.
  }
}
