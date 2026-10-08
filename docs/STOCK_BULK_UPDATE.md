# Stock ek saath update karna (Excel)

Har product ka stock ek-ek karke daalna mumkin nahi hai, isliye poora stock ek Excel sheet se update hota hai.

**Admin → Inventory → "Bulk update (Excel)"**

## 3 steps

### 1. Stock sheet download karo
**Download stock sheet** dabao. Ek file aayegi (`nutex-stock-YYYY-MM-DD.csv`), jisme har product ka har colour + size ek row mein hai, aaj ke stock ke saath.

> **Stock sirf pcs mein daala jaata hai, box mein nahi.** Box apne aap loose pcs se bante hain (har colour ke barabar pcs), isliye sheet mein box ki rows hoti hi nahi.

| Column | Matlab |
|---|---|
| `inventory_id` | Website ka apna number – **mat badlo** |
| `category`, `product_sku`, `product_name` | Product |
| `type` | `PCS` (loose pieces) |
| `colour`, `size` | Colour aur size |
| `current_stock` | Download ke waqt ka stock – **mat badlo** |
| `reserved` | Unpaid orders ne rok rakha hai |
| `new_stock` | **Aap bharo:** gina hua stock (purana stock iss number se badal jayega) |
| `add_stock` | **Aap bharo:** naya maal aaya (current stock mein jud jayega) |
| `note` | Jaankari |

### 2. Excel mein bharo
- Sirf un rows mein number daalo jinka stock badalna hai. Baaki khaali chhod do – woh nahi badlengi.
- Ek row mein **ya** `new_stock` **ya** `add_stock` – dono nahi.
- Excel ke filter (Data → Filter) se category / product / size chhaant kar bharna aasaan hai. Ek jaisa number ho to pehli cell bhar kar neeche drag kar do.
- **Box ka stock kahin nahi daalna.** Box loose pcs se apne aap bante hain. Kisi size ka box band karna ho to Inventory page par us box ko "Out of stock" kar do.
- Save: **File → Save As → "CSV UTF-8 (Comma delimited)"**. (Google Sheets: File → Download → CSV.)

### 3. Upload karo
**Choose CSV file** → file chuno. Pehle **preview** dikhega:
- kitni rows badlengi (abhi → naya stock)
- kitni rows mein galti hai aur kyon (jaise "Enter whole numbers only")

Kuch bhi save **nahi** hota jab tak aap **Apply** nahi dabate. Galti wali rows chhod di jaati hain, baaki update ho jaati hain.

## Suraksha (data safe rehta hai)
- Sirf stock ki cell badalti hai, kuch delete nahi hota. Har upload Audit Log mein likha jaata hai.
- Download ke baad agar kisi row ka stock order se badal gaya (payment aa gaya), to uss row ka `new_stock` **nahi** lagega – sheet dobara download karo. (`add_stock` hamesha current stock mein judta hai.)
- Stock kabhi bhi "reserved" se kam nahi ho sakta.
- `inventory_id` hata diya ho to bhi `product_sku` + `colour` + `size` + `type` se row pehchaan li jaati hai.

## Kab kya use karein
- **Pehli baar / stock gin kar:** `new_stock`
- **Naya maal aaya (production / purchase):** `add_stock`
- **Ek-do product:** Inventory page par seedha product chuno aur matrix mein likho.
