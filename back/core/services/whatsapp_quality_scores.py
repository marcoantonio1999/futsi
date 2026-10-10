"""Reproducible statistics over provider judgments; not verified sales."""
CHOICES = {
    "courtesy": {"respetuosa": 100, "mejorable": 50, "inadecuada": 0},
    "useful_response": {"completa": 100, "parcial": 50, "insuficiente": 0},
    "commercial_initiative": {"proactiva": 100, "reactiva": 50, "ausente": 0},
    "concrete_next_step": {"concretado": 100, "propuesto_sin_concretar": 50, "faltante": 0},
    "follow_up": {"activo": 100, "pasivo": 50, "sin_seguimiento_visible": 0},
}


def scores(result):
    value = {key: choices.get(result.get(key)) for key, choices in CHOICES.items()}
    sales = [value[key] for key in ("useful_response", "concrete_next_step") if value[key] is not None]
    value["seller"] = round(sum(sales) / len(sales), 1) if sales and result.get("segment") == "prospecto" else None
    return value


def score_summary(rows):
    completed = [row for row in rows if row["status"] == "completed"]
    result = {}
    for criterion in [*CHOICES, "seller"]:
        values = [scores(row["result"])[criterion] for row in completed]
        graded = [value for value in values if value is not None]
        result[criterion] = {"score": round(sum(graded) / len(graded), 1) if graded else None,
            "evaluated": len(graded), "not_evaluable": len(values) - len(graded),
            "requires_review": sum(row["result"].get("requires_review", False) and scores(row["result"])[criterion] is not None for row in completed)}
    return result


def cost_summary(rows):
    totals = {"input_tokens": 0, "cached_tokens": 0, "output_tokens": 0}
    known = 0
    for row in rows:
        usage = row["usage"] or {}
        if row["model"] != "gpt-6-luna" or not {"input_tokens", "output_tokens"}.issubset(usage):
            continue
        known += 1
        totals["input_tokens"] += usage["input_tokens"]
        totals["output_tokens"] += usage["output_tokens"]
        totals["cached_tokens"] += usage.get("input_tokens_details", {}).get("cached_tokens", 0)
    return {**totals, "recorded_calls": known, "estimated_usd": round(((totals["input_tokens"] - totals["cached_tokens"]) * .1 + totals["cached_tokens"] * .01 + totals["output_tokens"] * .5) / 1000000, 6) if known else None,
        "is_estimate": True, "excludes_unrecorded_attempts": True,
        "pricing_source": "https://developers.openai.com/api/docs/models/gpt-6-luna"}
