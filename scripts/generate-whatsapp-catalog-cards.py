#!/usr/bin/env python3
"""Generate separate, catalog-only WhatsApp promo photos using PixelHouse product photos.
No original images are modified. Output: dist/whatsapp-cards/*.jpg and manifest.csv.
"""
import csv
import io
import json
import math
import re
import urllib.request
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter, ImageChops

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'whatsapp-cards'
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 1200
PHONE = '0777466675'
ORIGIN = 'https://pixelhouse.lk'

PALETTES = {
    'camping': ((14, 45, 32), (35, 98, 56), (235, 191, 94), 'CAMPING GEAR'),
    'gopro': ((8, 21, 43), (10, 76, 132), (23, 190, 247), 'GoPro'),
    'dji': ((12, 26, 31), (24, 73, 74), (73, 227, 171), 'DJI'),
    'insta360': ((26, 15, 54), (85, 49, 121), (217, 148, 244), 'INSTA360'),
}

def font(size, bold=True):
    file = '/usr/share/fonts/truetype/dejavu/DejaVuSans-%s.ttf' % ('Bold' if bold else '')
    if not bold:
        file = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    try:
        return ImageFont.truetype(file, size)
    except OSError:
        return ImageFont.load_default()

def text_width(draw, value, face):
    box = draw.textbbox((0, 0), value, font=face)
    return box[2] - box[0]

def wrap_title(draw, label, max_width=1030, max_lines=3):
    words = label.replace(' — ', ' - ').split()
    for sz in (77, 70, 63, 56, 49, 44, 39):
        f = font(sz)
        lines, current = [], ''
        for w in words:
            test = (current + ' ' + w).strip()
            if current and text_width(draw, test, f) > max_width:
                lines.append(current)
                current = w
            else:
                current = test
        if current:
            lines.append(current)
        if len(lines) <= max_lines:
            return lines, f
    return lines[:max_lines], f

def category(row):
    label = (str(row.get('category_name') or row.get('category') or '') + ' ' +
             str(row.get('name', ''))).lower()
    if 'camp' in label or 'trekking' in label or 'headlamp' in label:
        return 'camping'
    if 'osmo' in label or 'dji' in label:
        return 'dji'
    if 'insta360' in label or 'insta 360' in label or 'x4' in label:
        return 'insta360'
    return 'gopro'

def fetch_image(row):
    src = str(row.get('image') or '')
    if src.startswith('data:image/') and ';base64,' in src:
        import base64
        return Image.open(io.BytesIO(base64.b64decode(src.split(',', 1)[1]))).convert('RGBA')
    if src.startswith('http://') or src.startswith('https://'):
        if not src.startswith(ORIGIN + '/'):
            raise ValueError('Ignoring third-party image URL')
        url = src
    else:
        image_path = src.lstrip('/')
        rel = Path(image_path)
        if not image_path.startswith('img/') or '..' in rel.parts:
            raise ValueError('Unsupported image path: ' + image_path[:80])
        local = ROOT / rel
        if local.is_file():
            return Image.open(local).convert('RGBA')
        url = ORIGIN + '/' + image_path
    request = urllib.request.Request(url, headers={'User-Agent': 'PixelHouseCatalogImageBuilder/1.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return Image.open(io.BytesIO(response.read())).convert('RGBA')

def get_catalog():
    # Prefer today's active public catalog, including admin-uploaded photos.
    request = urllib.request.Request(ORIGIN + '/api/products',
         headers={'User-Agent': 'PixelHouseCatalogImageBuilder/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=25) as resp:
            live = json.load(resp).get('products', [])
        live = [p for p in live if p.get('status') == 'active']
        if live:
            print('Using current website products:', len(live))
            return live, 'live'
    except Exception as exc:
        print('Live catalog unavailable; use GitHub source products:', str(exc)[:170])

    # Offline fallback reads photos and titles checked into the repository.
    items = []
    seed_text = (ROOT / 'server/seed-data.js').read_text(encoding='utf-8')
    seed_section = seed_text.split('const SEED_PRODUCTS = [', 1)[1].split('\n];', 1)[0]
    for line in seed_section.splitlines():
        match = re.search(r"\bslug:\s*'([^']+)'.*?\bname:\s*'([^']+)'.*?\bimage:\s*'([^']+)'", line)
        if match:
            slug, name, image = match.groups()
            items.append({'slug': slug, 'name': name, 'image': image,
                          'category': 'GoPro Accessories', 'status': 'active'})
    for file in ('accessories-20261109.json', 'camping-20261109.json'):
        for p in json.loads((ROOT / 'catalog' / file).read_text(encoding='utf-8')):
            if p.get('status') == 'active':
                p = dict(p)
                p['image'] = p.get('zoom_image') or p.get('image')
                items.append(p)
    print('Using GitHub source products:', len(items))
    return items, 'github'

def gradient(top, bottom):
    strip = Image.new('RGB', (1, SIZE))
    pix = strip.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        pix[0, y] = tuple(round(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
    return strip.resize((SIZE, SIZE))

def crop_subject(image):
    """Trim excess white/transparent padding but never change the product itself."""
    img = image.convert('RGBA')
    # Transparent PNGs can be cropped exactly by their alpha silhouette.
    alpha = img.getchannel('A')
    bbox = alpha.point(lambda v: 255 if v > 15 else 0).getbbox()
    if bbox and (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) < 0.91 * img.width * img.height:
        pass
    else:
        # Typical PixelHouse photos are of objects centered on pure-white pages.
        # Detect the contrast region and keep generous margins.
        diff = ImageChops.difference(img.convert('RGB'),
                                     Image.new('RGB', img.size, 'white')).convert('L')
        bbox = diff.point(lambda v: 255 if v > 27 else 0).getbbox()
    if not bbox:
        return img
    left, top, right, bottom = bbox
    if right - left < 18 or bottom - top < 18:
        return img
    pad = max(18, int(max(right-left, bottom-top) * .07))
    return img.crop((max(0, left-pad), max(0, top-pad),
                     min(img.width, right+pad), min(img.height, bottom+pad)))

def build(row, original):
    cat = category(row)
    dark, mid, accent, label = PALETTES[cat]
    card = gradient(dark, mid).convert('RGBA')
    draw = ImageDraw.Draw(card, 'RGBA')

    # Visual identity differs by product family. Keep bottom area clear.
    for i in range(5):
        x, y = 990 + i * 37, 70 + i * 50
        draw.ellipse((x-220, y-100, x+220, y+340),
                     outline=(*accent, 25), width=10)
    draw.rounded_rectangle((38, 35, 1162, 1025), radius=38,
                           outline=(*accent, 110), width=3)
    draw.rounded_rectangle((63, 52, 1136, 118), radius=18, fill=(0,0,0,95))
    draw.text((88, 68), 'PIXEL HOUSE', font=font(29), fill='white')

    right = ('CAMPING COLLECTION' if cat == 'camping'
        else 'GoPro  |  COMPATIBLE' if cat == 'gopro'
        else 'DJI  |  OSMO ACCESSORIES' if cat == 'dji'
        else 'INSTA360  |  ACCESSORIES')
    rf = font(24)
    draw.text((1112 - text_width(draw, right, rf), 74), right,
              font=rf, fill=(*accent, 255))

    lines, titlefont = wrap_title(draw, str(row.get('name') or 'Product'))
    gap = titlefont.size + 10
    for n, title_line in enumerate(lines):
        draw.text((85, 150 + n * gap), title_line,
                  font=titlefont, fill='white', stroke_width=1,
                  stroke_fill=(0,0,0))
    title_bottom = 150 + len(lines) * gap
    top_photo = min(max(title_bottom + 12, 285), 415)
    bottom_photo = 930
    photo_rect = (84, top_photo, 1116, bottom_photo)

    # A clean matte presentation retains the real product silhouette, logos and colors.
    draw.rounded_rectangle((photo_rect[0] + 7, photo_rect[1] + 13,
                            photo_rect[2] + 7, photo_rect[3] + 13),
                           radius=35, fill=(0,0,0,100))
    draw.rounded_rectangle(photo_rect, radius=35,
                           fill=(247, 249, 248, 255))

    photo = crop_subject(original)
    if photo.mode != 'RGBA':
        photo = photo.convert('RGBA')
    photo = ImageEnhance.Contrast(photo).enhance(1.07)
    photo = ImageEnhance.Sharpness(photo).enhance(1.30)
    # Fit the photo without cropping or modifying the product's shape.
    photo.thumbnail((970, bottom_photo-top_photo-38), Image.Resampling.LANCZOS)
    px = (SIZE - photo.width) // 2
    py = top_photo + (bottom_photo - top_photo - photo.height) // 2
    card.alpha_composite(photo, (px, py))

    draw = ImageDraw.Draw(card, 'RGBA')
    # Footer is persistent and legible after WhatsApp's thumbnail crop.
    draw.rounded_rectangle((62, 951, 1138, 1146), radius=31, fill=(0,0,0,208))
    draw.text((88, 971), 'CASH ON DELIVERY', font=font(34),
              fill=(*accent, 255))
    draw.text((90, 1038), PHONE, font=font(58), fill='white')
    draw.rounded_rectangle((726, 1032, 1113, 1115), radius=29,
                           fill=(*accent, 255))
    cta = 'SHOP NOW'
    cf = font(37)
    draw.text((726 + (387 - text_width(draw, cta, cf)) // 2, 1051),
              cta, font=cf, fill=dark)
    return card.convert('RGB')

def main():
    products, source = get_catalog()
    records, images, missing = [], [], []
    for index, product in enumerate(products, 1):
        try:
            photo = fetch_image(product)
            item_id = 'PH-' + str(product['id']) if product.get('id') else product.get('slug', f'item-{index}')
            file_name = re.sub(r'[^a-zA-Z0-9_-]', '-', item_id) + '.jpg'
            output = OUT / file_name
            build(product, photo).save(output, 'JPEG', quality=94, subsampling=0, optimize=True)
            records.append({
                'catalog_id': item_id, 'name': product['name'],
                'category': category(product), 'source_image': (
                    'database-upload' if str(product.get('image', '')).startswith('data:')
                    else product.get('image', '')),
                'whatsapp_image': file_name,
            })
            images.append((file_name, output))
        except Exception as error:
            missing.append((product.get('name', 'unknown'), str(error)))
            print('SKIP:', product.get('name'), type(error).__name__, str(error)[:130])
    with (OUT / 'manifest.csv').open('w', newline='', encoding='utf-8-sig') as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            'catalog_id', 'name', 'category', 'source_image', 'whatsapp_image'])
        writer.writeheader()
        writer.writerows(records)
    if images:
        thumb = Image.new('RGB', (5*260, math.ceil(min(25, len(images))/5)*260), 'white')
        for n, (_, file) in enumerate(images[:25]):
            with Image.open(file) as sample:
                sample.thumbnail((248, 248))
                thumb.paste(sample, ((n%5)*260+6, (n//5)*260+6))
        thumb.save(OUT / 'contact-sheet.jpg', quality=90)
    (OUT / 'README.txt').write_text(
        'PixelHouse WhatsApp-specific product photos\\n'
        'Generated from ' + source + ' originals. Website photos are unchanged.\\n'
        'Images: ' + str(len(records)) + '; skipped: ' + str(len(missing)) + '\\n'
        'Every image includes the actual product photo, product name, 0777466675,\\n'
        'Cash on Delivery, Shop Now, and a family-specific design.\\n'
        'Review all images before publishing to Meta/WhatsApp; particularly\\n'
        'compatibility, brand wording, and any items no longer sold.\\n'
        + ('Missing:\\n' + '\\n'.join(a + ': ' + b for a,b in missing) if missing else ''),
        encoding='utf-8')
    print('Generated:', len(records), 'of', len(products), 'products', source)
    if not images:
        raise SystemExit('No product images were generated')

if __name__ == '__main__':
    main()
