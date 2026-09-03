from django.core.management.base import BaseCommand, CommandError

from core.voice.retention import purge_expired_voice_data


class Command(BaseCommand):
    help = "Elimina transcripciones/llamadas vencidas y anonimiza pruebas concluidas."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Solo muestra cuántos registros serían afectados.",
        )
        parser.add_argument(
            "--max-batches",
            type=int,
            default=100,
            help="Máximo de lotes a procesar en una ejecución (default: 100).",
        )

    def handle(self, *args, **options):
        max_batches = options["max_batches"]
        if max_batches < 1:
            raise CommandError("--max-batches debe ser al menos 1.")
        result = {
            "transcripts_deleted": 0,
            "calls_deleted": 0,
            "bookings_anonymized": 0,
        }
        batches = 0
        while batches < max_batches:
            batch_result = purge_expired_voice_data(dry_run=options["dry_run"])
            batches += 1
            for key, count in batch_result.items():
                result[key] += count
            if options["dry_run"] or not any(batch_result.values()):
                break

        prefix = "Simulación" if options["dry_run"] else "Retención aplicada"
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}: "
                f"{result['transcripts_deleted']} transcripciones, "
                f"{result['calls_deleted']} llamadas, "
                f"{result['bookings_anonymized']} reservas anonimizadas "
                f"en {batches} lote(s)."
            )
        )
        if (
            not options["dry_run"]
            and batches == max_batches
            and any(batch_result.values())
        ):
            self.stderr.write(
                self.style.WARNING(
                    "Se alcanzó --max-batches; ejecuta el comando de nuevo para "
                    "confirmar que no quede rezago."
                )
            )
