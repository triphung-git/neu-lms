from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import (
    BaseCommand,
    CommandError,
)

from ai_assistant.evaluation_metrics import (
    hit_at_k,
    precision_at_k,
    ranked_unique_pages,
    recall_at_k,
    reciprocal_rank_at_k,
)
from ai_assistant.hybrid_retrieval import (
    retrieve_course_chunks_hybrid,
)
from ai_assistant.retrieval import retrieve_course_chunks
from courses.models import Course


class Command(BaseCommand):
    help = "Evaluate BM25 or Hybrid RAG retrieval."

    def add_arguments(self, parser):

        parser.add_argument(
            "--course-id",
            required=True,
            type=str,
        )

        parser.add_argument(
            "--retriever",
            choices=["bm25", "hybrid"],
            default="bm25",
        )

        parser.add_argument(
            "--dataset",
            default="web101",
        )

        parser.add_argument(
            "--top-k",
            type=int,
            default=5,
        )

        parser.add_argument(
            "--limit",
            type=int,
            default=None,
        )

    def handle(self, *args, **options):

        top_k = options["top_k"]

        if not 1 <= top_k <= 10:
            raise CommandError("--top-k must be between 1 and 10.")

        if options["limit"] is not None:
            if options["limit"] <= 0:
                raise CommandError("--limit must be positive.")

        dataset_name = options["dataset"]

        if not dataset_name.replace("_", "").isalnum():
            raise CommandError("Invalid dataset name.")

        dataset_path = Path(__file__).resolve().parents[2] / "evaluation" / f"{dataset_name}.json"

        if not dataset_path.is_file():
            raise CommandError(f"Dataset not found: {dataset_path}")

        try:
            with dataset_path.open(
                "r",
                encoding="utf-8",
            ) as file:
                dataset = json.load(file)

        except (OSError, json.JSONDecodeError) as exc:
            raise CommandError(f"Cannot read evaluation dataset: {exc}") from exc

        cases = dataset.get("cases", [])

        if not cases:
            raise CommandError("Evaluation dataset contains no cases.")

        if options["limit"]:
            cases = cases[: options["limit"]]

        try:
            course = Course.objects.get(pk=options["course_id"])
        except (Course.DoesNotExist, ValueError):
            raise CommandError("Course not found.") from None

        expected_code = dataset.get("course_code", "")

        if course.code.casefold() != expected_code.casefold():
            raise CommandError(
                f"Dataset is for {expected_code}, but selected course is {course.code}."
            )

        retriever = (
            retrieve_course_chunks
            if options["retriever"] == "bm25"
            else retrieve_course_chunks_hybrid
        )

        answerable_metrics = []
        unsupported_cases = []

        self.stdout.write(self.style.SUCCESS(f"Dataset: {dataset['dataset_id']}"))

        self.stdout.write(f"Course: {course.code} - {course.name}")

        self.stdout.write(f"Retriever: {options['retriever'].upper()}")

        self.stdout.write(f"Top-K: {top_k}")
        self.stdout.write("")

        for case in cases:
            question = case["question"]

            answerable = bool(case.get("answerable", True))

            relevant_pages = case.get(
                "relevant_pages",
                [],
            )

            if answerable and not relevant_pages:
                raise CommandError(f"Answerable case {case['id']} must have relevant_pages.")

            results = retriever(
                course,
                question,
                top_k=top_k,
            )

            pages = ranked_unique_pages(results)

            self.stdout.write(f"\n[{case['id']}] {question}")

            self.stdout.write(f"Retrieved pages: {pages}")

            if answerable:
                metrics = {
                    "precision": precision_at_k(
                        results,
                        relevant_pages,
                        top_k,
                    ),
                    "recall": recall_at_k(
                        results,
                        relevant_pages,
                        top_k,
                    ),
                    "mrr": reciprocal_rank_at_k(
                        results,
                        relevant_pages,
                        top_k,
                    ),
                    "hit": hit_at_k(
                        results,
                        relevant_pages,
                        top_k,
                    ),
                }

                answerable_metrics.append(metrics)

                self.stdout.write(f"Expected pages: {relevant_pages}")

                self.stdout.write(
                    "P@K={precision:.3f} | "
                    "R@K={recall:.3f} | "
                    "RR@K={mrr:.3f} | "
                    "Hit@K={hit:.0f}".format(**metrics)
                )

            else:
                has_results = bool(results)

                unsupported_cases.append(has_results)

                self.stdout.write(f"Expected: NO SUPPORT | Retrieved: {len(results)}")

                self.stdout.write(
                    "OOD retrieval: "
                    + (
                        self.style.WARNING("FALSE POSITIVE")
                        if has_results
                        else self.style.SUCCESS("PASS")
                    )
                )

        self.stdout.write("\n")
        self.stdout.write(self.style.SUCCESS("========== EVALUATION SUMMARY =========="))

        count = len(answerable_metrics)

        if count:
            for metric in (
                "precision",
                "recall",
                "mrr",
                "hit",
            ):
                average = sum(item[metric] for item in answerable_metrics) / count

                self.stdout.write(f"{metric.upper()}@{top_k}: {average:.4f} ({average * 100:.2f}%)")

        else:
            self.stdout.write("No answerable cases were evaluated.")

        if unsupported_cases:
            false_positives = sum(unsupported_cases)

            rate = false_positives / len(unsupported_cases)

            self.stdout.write(
                f"OOD retrieval rate: {rate:.4f} ({false_positives}/{len(unsupported_cases)})"
            )

        self.stdout.write(f"Total cases: {len(cases)}")
