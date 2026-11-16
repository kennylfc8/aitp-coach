"""Contact sheet from PNG frames: python tools/ace_sheet.py <out.jpg> <cols> <frame1.png> ... (labels from file names)."""
import sys
from PIL import Image, ImageDraw
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert("RGB") for f in files]
w, h = ims[0].size; rows = -(-len(ims) // cols); pad = 6; lab = 22
sheet = Image.new("RGB", (cols * (w + pad) + pad, rows * (h + pad + lab) + pad), (16, 18, 20))
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x = pad + (i % cols) * (w + pad); y = pad + (i // cols) * (h + pad + lab)
    sheet.paste(im.resize((w, h)), (x, y + lab)); d.text((x + 4, y + 4), f.replace("\\", "/").split("/")[-1].rsplit(".", 1)[0], fill=(200, 230, 80))
sheet.save(out, quality=88); print(out, sheet.size)
