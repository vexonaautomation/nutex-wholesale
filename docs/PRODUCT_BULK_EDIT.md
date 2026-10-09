# Products ek saath edit karna (Excel)

**Admin → Products → "Bulk edit (Excel)"**

Ek-ek product kholne ki zaroorat nahi: sab products ek Excel file mein aate hain, aap Excel mein badlo, upload karo.

## 1. Download
**Download Excel** dabao. Agar list mein kuch products tick kiye hain to sirf wahi aayenge, warna saare.

File mein 4 tabs hain:

| Tab | Kya hai |
|---|---|
| **Products** | Har product ki ek row |
| **Stock** | Har colour + size ki ek row, aaj ke stock ke saath (sirf pcs) |
| **Lists** | Kaun si categories, sizes, colours use kar sakte ho |
| **How to use** | Chhoti si guide |

## 2. Excel mein badlo

### Products tab
| Column | Kaise likhna hai |
|---|---|
| `product_id` | **Mat badlo** – isi se product pehchana jaata hai |
| `sku`, `product_name` | Seedha badlo |
| `category` | Dropdown se chuno |
| `mrp` | Number (per piece) |
| `own_discount_%` | Khaali = Settings wala discount; number = is product ka apna discount |
| `pieces_per_box` | Box mein kitne pcs; khaali = box nahi |
| `loose_pcs_for_new_customers` | Yes / No |
| `sizes` | Comma se: `32, 34, 36, 38`. **Size hatana** = text se mita do. **Size jodna** = likh do |
| `colours` | Comma se: `Coral, Maroon, Lime Green` – hatana / jodna waise hi |
| `size_mrp` | Sirf agar bade size mehnge hain: `42=165, 44=170` |
| `status` | Active / Inactive |
| `featured` | Yes / No |

Naya size ya colour pehle Admin → Sizes / Colours mein bana hona chahiye (naam Lists tab mein dikhte hain).

### Stock tab (zaroori nahi)
- `new_stock` = gina hua stock (purana badal jayega), `add_stock` = naya maal aaya (jud jayega). Khaali = stock waisa hi.
- **Naye size ka stock** isi file mein: Stock tab mein nayi row jodo – `product_id`, `colour`, `size`, `new_stock`. Size banne ke turant baad stock lag jayega.
- Box ka stock nahi hota – box pcs se apne aap bante hain.

Save karo **.xlsx** format mein hi.

## 3. Upload
**Choose Excel file** → file chuno → **preview** dikhega:
- kaun sa product badlega aur kya (`MRP: 80 → 85`, `+ size 42`, `− size 80-90`, `+ colour Red` …)
- kitna stock badlega
- kis row mein galti hai aur kyon (jaise "Size 43 is not in the size list")

Kuch save **nahi** hota jab tak **Apply changes** nahi dabate. Galti wali rows chhod di jaati hain, baaki lag jaati hain.

## Data safe
- Sirf wahi cells badalti hain jo aapne badli. Photos, description, URL nahi chhede jaate.
- Hataya hua size / colour **band** hota hai, delete nahi – uska stock aur purane orders bache rehte hain; wapas jodo to wahi stock laut aata hai.
- Har badlaav Audit Log mein.
- Naye products yahan se nahi bante – "Add product" se banao.
