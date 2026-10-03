"""Jev-as-judge evaluators for Azure AI Foundry (azure-ai-evaluation compatible)."""
from .evaluators import (METRICS, JevAgentJudge, JevGroundednessEvaluator, JevIntentResolutionEvaluator,
                         JevTaskAdherenceEvaluator, JevToolCallAccuracyEvaluator)
from .jev_client import JevClient

__version__ = "1.0.0"
__all__ = ["JevAgentJudge", "JevIntentResolutionEvaluator", "JevTaskAdherenceEvaluator",
           "JevToolCallAccuracyEvaluator", "JevGroundednessEvaluator", "JevClient", "METRICS"]
