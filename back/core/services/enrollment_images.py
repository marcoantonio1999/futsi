from io import BytesIO
from PIL import Image, ImageOps

PHOTO_MAX_BYTES = 3_000_000


def compress_document_photo(content):
    """Fallback for older clients: retain PDFs/signatures outside this helper."""
    if len(content) <= PHOTO_MAX_BYTES:
        return content
    with Image.open(BytesIO(content)) as original:
        image = ImageOps.exif_transpose(original)
        rgba = image.convert('RGBA')
        rgb = Image.new('RGB', rgba.size, 'white')
        rgb.paste(rgba, mask=rgba.getchannel('A'))
        rgb.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
        for _ in range(8):
            for quality in (92, 85, 78, 70):
                output = BytesIO()
                rgb.save(output, 'JPEG', quality=quality, optimize=True)
                if output.tell() <= PHOTO_MAX_BYTES:
                    return output.getvalue()
            rgb = rgb.resize((max(1, int(rgb.width * .8)), max(1, int(rgb.height * .8))), Image.Resampling.LANCZOS)
    raise ValueError('No se pudo comprimir la foto a 3 MB.')
