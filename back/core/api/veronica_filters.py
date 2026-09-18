import unicodedata

from core.models import VeronicaFilterOption


DEFAULTS = {
    VeronicaFilterOption.Dimension.PLATFORM: ("OCC", "Computrabajo", "Indeed"),
    VeronicaFilterOption.Dimension.VACANCY_TYPE: ("Coach", "Administrativo", "Contador"),
}


def clean_label(value):
    if not isinstance(value, str) or value.lstrip().startswith("="):
        return ""
    return " ".join(value.split())[:80]


def normalized_label(value):
    plain = "".join(
        char for char in unicodedata.normalize("NFKD", clean_label(value).casefold())
        if not unicodedata.combining(char)
    )
    return " ".join(plain.split())


def ensure_option(dimension, value, actor=None):
    if dimension not in DEFAULTS:
        raise ValueError("Tipo de filtro inválido.")
    label = clean_label(value)
    normalized = normalized_label(label)
    if not label or not normalized:
        raise ValueError("Escribe un nombre para el filtro.")
    option, created = VeronicaFilterOption.objects.get_or_create(
        dimension=dimension,
        normalized_label=normalized,
        defaults={"label": label, "created_by": actor},
    )
    if not option.is_active:
        option.is_active = True
        option.save(update_fields=["is_active", "updated_at"])
    return option, created


def ensure_defaults(actor=None):
    for dimension, labels in DEFAULTS.items():
        for label in labels:
            ensure_option(dimension, label, actor)


def ensure_imported(filters, actor=None):
    ensure_defaults(actor)
    created = {"platform": [], "vacancy_type": []}
    if not isinstance(filters, dict):
        return created
    for metadata in filters.values():
        if not isinstance(metadata, dict):
            continue
        for dimension in created:
            value = metadata.get(dimension)
            if value:
                option, made = ensure_option(dimension, value, actor)
                metadata[dimension] = option.label
                if made:
                    created[dimension].append(option.label)
    return created


def catalog(actor=None):
    ensure_defaults(actor)
    rows = VeronicaFilterOption.objects.filter(is_active=True)
    return {
        "platforms": [row.label for row in rows if row.dimension == "platform"],
        "vacancy_types": [row.label for row in rows if row.dimension == "vacancy_type"],
    }
