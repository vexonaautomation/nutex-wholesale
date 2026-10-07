# Existing customers ko ek saath import karna (Excel template)

Existing customer = jo pehle Nutex se khareed chuka hai. Inhe **minimum order nahi lagta** aur ye har product par **box ya loose pcs** chun sakte hain (WhatsApp OTP se verify hone ke baad).

## Template
- Admin → **Existing Customers** → **Bulk add** → **Download the template**
- Ya seedha file: `client/public/templates/existing-customers-template.csv` (live site par: `https://<aapki-site>/templates/existing-customers-template.csv`)

Excel mein kholo. Columns:

| Column | Zaroori? | Kya likhna hai | Example |
|---|---|---|---|
| `mobile` | **Haan** | Customer ka WhatsApp number (10 digit; +91 / space chalega) | `9876543210` |
| `customer_name` | Nahi | Naam | `Riya Sharma` |
| `business_name` | Nahi | Dukaan / firm ka naam | `Riya Fashion` |
| `city` | Nahi | Shahar | `Pune` |
| `alternate_mobiles` | Nahi | Customer ke dusre WhatsApp numbers (max 5), `/` se alag | `9123456789 / 9988776655` |
| `gstin` | Nahi | GST number | `27ABCDE1234F1Z5` |
| `minimum_order_value` | Nahi | Is customer ka apna minimum order ₹. **Khaali = default (0, koi minimum nahi)** | `2000` |
| `notes` | Nahi | Kuch bhi yaad rakhne layak | `since 2019` |

Template ki **2 example rows** (notes mein "EXAMPLE ROW") delete kar dena. Galti se reh bhi gayi to website unhe add nahi karegi.

## Website mein daalna (2 tareeke)
1. **Copy-paste (sabse aasaan):** Excel mein poori table **header row ke saath** select karo → `Ctrl + C` → Admin → Existing Customers → **Bulk add** → box mein `Ctrl + V` → **Add numbers**.
2. **CSV file:** Excel → File → Save As → **CSV (Comma delimited)** → Bulk add → **upload the CSV file** → **Add numbers**.

Result turant dikhega: kitne add hue, kitne skip hue aur kyon (jaise "Already listed", "Invalid mobile number").

## Niyam
- Jo number pehle se list mein hai woh **skip** hota hai — kuch overwrite nahi hota. Badalna ho to list mein us customer par ✏️ (edit) dabao.
- Ek number sirf ek customer ka ho sakta hai (alternate numbers bhi).
- Ek baar mein 3000 customers tak.
- Columns kisi bhi order mein ho sakte hain, naam se pehchaane jaate hain (`Mobile Number`, `Name`, `Shop`, `GST No` jaise naam bhi chalte hain). Extra columns ignore ho jaate hain.

## Google Sheet mein seedha (optional)
Sheet ke **`Existing_Customers`** tab mein bhi seedha row likh sakte ho: column A = `mobile`. Website use agle 1 minute mein pehchaan legi. Admin wala tareeka behtar hai kyunki woh galat number aur duplicate pakad leta hai.

## Customer ka kya hoga
Customer website par **"Existing customer?"** dabata hai → mobile daalta hai → WhatsApp par OTP aata hai → verify. Phir:
- ₹10,000 ka minimum nahi (ya jo `minimum_order_value` aapne diya)
- Har product par **box ya loose pcs**

Naya customer jiska pehla payment aap verify karte ho, woh **apne aap** is list mein jud jata hai (Settings → "After the first paid order").
