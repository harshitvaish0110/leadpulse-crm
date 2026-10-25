"""
Feature definitions shared by train.py and the prediction routes. They match the
columns of the ml_contact_features / ml_deal_features views, which are the single
source of these values for both training and serving.
"""

CHURN_FEATURES = [
    "days_since_last_contact",
    "activity_count_30d",
    "activity_count_90d",
    "avg_sentiment",
    "deal_count",
    "total_deal_value",
    "has_open_deal",
]

WIN_FEATURES = [
    "stage_ordinal",
    "deal_value",
    "days_in_current_stage",
    "total_activities",
    "activity_last_7d",
    "contact_seniority",
    "company_size",
]
