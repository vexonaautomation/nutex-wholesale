# Nutex catalogue import

Source: `NUTEX CATELOGUE ALL PRODUCT 01-10-2026.pdf` (prices W.E.F. 01-04-2026).

```
catalog-import/
├── catalog.json            150 products + categories, colours, sizes (edit before importing if needed)
└── images/
    ├── products/pNNN.jpg   one image per product = catalogue page NNN (1000×1000)
    ├── categories/*.jpg    category cover pages (Lingerie Set, Padded Bra, …)
    └── brand/              logo.png, size-chart.jpg
```

## Rules used when reading the PDF
- **One catalogue page = one product** with its own image. Info / terms pages and section covers are not products.
- Name, style no. (SKU) and MRP are exactly as printed. Size-wise MRPs (Bloomer, Redazzle, Eva, men's vests and trunks) are in `size_mrp`; `mrp` is the lowest.
- **Colours** were read from the colour thumbnails / swatches on each page (named by eye, e.g. *Rani Pink*, *Sage Green*; two-tone styles like *Grey-Red*). Assorted-print styles use *Assorted Print*.
- Style numbers printed for two different products (1010, 6013, 1118, 5130, 9052, 9053) get the product name appended so every SKU is unique, e.g. `1010-AAKRITI-SET`.
- Sizes are not printed for most styles, so defaults are used: bras 30–40, C-cup 34–42, panties 80-90 / 95-100, camisoles / shapewear S–XXL; men's sizes as printed.
- Entries with a `check` field need a quick look (Rambo vests: lower price assumed for S–L, higher for XL–XXL).

## Importing
- **Admin → Catalogue Import**: preview, enter per category **pcs per box** (blank = no box) and tick **Allow** where new customers may also buy loose pieces, starting stock, click Import (progress shown).
- or `npm run import:catalog -- --dry-run`, then e.g. `npm run import:catalog -- --box-all=6 --box=everyday-panty:12 --pcs-new=camisole-collection` (uses `.env`).
- A product can also carry its own `"units_per_box"` / `"pcs_for_new_customers"` in catalog.json (overrides the category choice).
- Existing customers can always buy a box or loose pieces. New customers buy boxes only (unless allowed), so give every category a box size.

The import is additive: existing SKUs are skipped and never changed, so it is safe to run again (it continues after an interruption). Edit `catalog.json` **before** the first import, or change products later in the admin product wizard.
