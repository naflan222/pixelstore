"""Lossless WebP display-size assets for existing category icons and footer logo."""
from pathlib import Path
from PIL import Image
import json
ROOT=Path(__file__).resolve().parents[1]
paths=['img/core-img/'+s for s in ['woman-clothes.png','grocery.png','rowboat.webp','tv-table.png','beach.webp','rental-services.webp','camera-trade.webp','pixelhouse-footer-logo.jpg']]
out=ROOT/'img/core-img/loading-20261115';out.mkdir(exist_ok=True)
existing=ROOT/'catalog/loading-image-sources.json'
images={k:v for k,v in (json.loads(existing.read_text()) if existing.exists() else {}).items() if k.startswith('img/product/')}
for source in paths:
 im=Image.open(ROOT/source).convert('RGBA');widths=[96,192,384] if 'footer-logo' not in source else [300,450,600]
 images[source]=[]
 for width in widths:
  height=round(im.height*width/im.width);target=out/(Path(source).stem+'-'+str(width)+'.webp')
  im.resize((width,height),Image.Resampling.LANCZOS).save(target,'WEBP',lossless=True,method=6)
  images[source].append({'src':target.relative_to(ROOT).as_posix(),'width':width})
# This transparent decorative image is converted losslessly at its original size.
source='img/bg-img/make-up.png';im=Image.open(ROOT/source).convert('RGBA');target=out/'make-up.webp';im.save(target,'WEBP',lossless=True,method=6)
images[source]=[{'src':target.relative_to(ROOT).as_posix(),'width':im.width}]
(ROOT/'catalog/loading-image-sources.json').write_text(json.dumps(images,indent=2)+'\n')
