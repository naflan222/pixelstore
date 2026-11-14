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
    # White/ivory editorial card designs; family-specific restrained accent.
    'camping': ((254, 253, 249), (246, 247, 240), (102, 123, 62), 'OUTDOOR & CAMPING'),
    'gopro': ((253, 254, 255), (242, 248, 252), (16, 141, 202), 'ACTION CAMERA GEAR'),
    'dji': ((254, 255, 254), (241, 249, 246), (19, 142, 125), 'OSMO ACCESSORIES'),
    'insta360': ((255, 253, 255), (249, 244, 253), (112, 88, 158), '360 CAMERA GEAR'),
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

def draw_logo(card):
    """Embed the genuine PixelHouse brand asset tracked in GitHub."""
    logo = ROOT / 'img/icons/icon-512x512.png'
    draw = ImageDraw.Draw(card, 'RGBA')
    draw.rounded_rectangle((69, 51, 163, 145), radius=21,
                           fill=(255, 255, 255, 255),
                           outline=(219, 222, 221, 255), width=2)
    if logo.is_file():
        with Image.open(logo) as actual:
            icon = actual.convert('RGBA')
            icon.thumbnail((86, 86), Image.Resampling.LANCZOS)
            card.alpha_composite(icon, (116 - icon.width // 2, 98 - icon.height // 2))
    else:
        draw.text((82, 78), 'PH', font=font(38), fill=(32, 35, 38, 255))
    draw.text((185, 72), 'PIXEL HOUSE', font=font(36),
              fill=(34, 37, 41, 255))
    draw.text((187, 119), 'CAMERAS  /  ACCESSORIES  /  OUTDOOR',
              font=font(16, False), fill=(99, 104, 105, 255))

def draw_brand(draw, cat, accent):
    """Category branding: compatible, not falsely marketed as OEM."""
    if cat == 'gopro':
        f=font(39)
        draw.text((995, 68), 'GoPro', font=f, fill=(32, 36, 41, 255))
        for i, col in enumerate(((0, 175, 228),(12, 137, 208),
                                 (18, 105, 181),(35, 35, 40))):
            draw.rounded_rectangle((1005+i*35, 113, 1034+i*35, 130),
                                   radius=2, fill=col)
        label='COMPATIBLE GEAR'
    elif cat == 'dji':
        draw.text((1021, 64), 'dji', font=font(49),
                  fill=(30, 38, 41, 255))
        label='OSMO ACCESSORIES'
    elif cat == 'insta360':
        draw.text((957, 70), 'INSTA360', font=font(27),
                  fill=(30, 38, 41, 255))
        label='360 CAMERA GEAR'
    else:
        label='OUTDOOR COLLECTION'
    small=font(15)
    draw.text((1140 - text_width(draw,label,small), 140),label,
              font=small,fill=(*accent, 255))

def build(row, original):
    cat = category(row)
    top, bottom, accent, category_label = PALETTES[cat]
    card = gradient(top, bottom).convert('RGBA')
    draw = ImageDraw.Draw(card, 'RGBA')
    neutral = (34, 38, 42, 255)
    muted = (117, 123, 124, 255)

    # Quiet designer-paper details inspired by the user's reference examples;
    # not a copy: no fake supplier watermarks, prices or extra products.
    for y in range(18, SIZE, 47):
        for x in range(20, SIZE, 47):
            draw.ellipse((x, y, x+1, y+1), fill=(15, 19, 20, 8))
    draw.arc((1040, 204, 1430, 590), 195, 330,
             fill=(*accent, 21), width=5)
    draw.arc((-270, 690, 190, 1150), 245, 342,
             fill=(*accent, 19), width=4)
    draw.rectangle((0, 0, 17, SIZE), fill=(*accent, 255))
    draw.rectangle((18, 0, 25, SIZE), fill=(*accent, 46))
    draw_logo(card)
    draw = ImageDraw.Draw(card, 'RGBA')
    draw_brand(draw, cat, accent)

    draw.line((69, 179, 1143, 179), fill=(208, 211, 210, 255), width=2)
    draw.rounded_rectangle((70, 207, 327, 250), radius=12,
                           fill=(*accent, 255))
    label=category_label[:26]
    mini=font(17)
    draw.text((83, 219), label, font=mini,
              fill=(255, 255, 255, 255))

    title = str(row.get('name') or 'Product').strip()
    lines, titlefont = wrap_title(draw, title, max_width=1040, max_lines=3)
    # Reflow at smaller size for very long product names.
    line_gap = titlefont.size + 12
    title_start = 276
    for n, title_line in enumerate(lines):
        draw.text((73, title_start+n*line_gap), title_line,
                  font=titlefont, fill=neutral)
    title_end = title_start + len(lines)*line_gap

    top_photo = min(max(title_end+15, 405), 517)
    bottom_photo = 1008
    # Product stage in off-white, no thick colored rectangles.
    stage = (57, top_photo, 1144, bottom_photo)
    shadow = (63, top_photo+8, 1149, bottom_photo+8)
    draw.rounded_rectangle(shadow, radius=28, fill=(27, 33, 37, 18))
    draw.rounded_rectangle(stage, radius=26,
                           fill=(255, 255, 255, 255),
                           outline=(226, 228, 227, 255), width=2)

    photo = crop_subject(original)
    if photo.mode != 'RGBA':
        photo = photo.convert('RGBA')
    photo = ImageEnhance.Contrast(photo).enhance(1.055)
    photo = ImageEnhance.Sharpness(photo).enhance(1.20)
    # Original product imagery is enlarged without distorting dimensions.
    target_w, target_h = 1015, bottom_photo-top_photo-32
    scale = min(target_w / photo.width, target_h / photo.height)
    photo = photo.resize((max(1,round(photo.width * scale)),
                          max(1,round(photo.height * scale))),
                          Image.Resampling.LANCZOS)
    if scale > 1.3:
        photo = photo.filter(ImageFilter.UnsharpMask(radius=0.8, percent=105, threshold=3))
    px, py = (SIZE-photo.width)//2, top_photo+(bottom_photo-top_photo-photo.height)//2

    # Merge opaque white-source photographs seamlessly into the white stage.
    # Fully transparent product cutouts retain the actual silhouette.
    card.alpha_composite(photo, (px,py))
    draw = ImageDraw.Draw(card, 'RGBA')

    draw.line((71, 1037, 1143, 1037), fill=(212, 215, 214, 255), width=2)
    # Ordering footer, deliberately smaller than the featured product.
    draw.text((75, 1057), 'WHATSAPP / CALL', font=font(21),
              fill=muted)
    draw.text((74, 1092), PHONE, font=font(43), fill=neutral)

    draw.text((485, 1059), 'CASH ON', font=font(25), fill=neutral)
    draw.text((485, 1090), 'DELIVERY', font=font(28), fill=(*accent, 255))

    draw.rounded_rectangle((821, 1065, 1141, 1138), radius=27,
                           fill=(*accent, 255))
    label='SHOP NOW'
    cf=font(34)
    x=821+(320-text_width(draw,label,cf))//2
    draw.text((x, 1081), label, font=cf, fill=(255, 255, 255, 255))
    draw.line((72, 1168, 1143, 1168), fill=(*accent, 80), width=2)
    draw.text((77, 1175), 'PIXELHOUSE.LK', font=font(16),
              fill=(122, 128, 130, 255))
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
