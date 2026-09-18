# Event and trigger matrix

| Event | From | To | Next trigger | Owner |
| --- | --- | --- | --- | --- |
| start_marketing | uninitialized | marketing_active | social_enquiry_or_asset_draft | Taylor |
| social_enquiry | marketing_active | social_enquiry_received | classify_enquiry | Taylor |
| classify_enquiry | social_enquiry_received | enquiry_classified | start_nurture_or_qualify_lead | Taylor |
| start_nurture | enquiry_classified / closed_lost | nurture | qualify_lead | Taylor |
| qualify_lead | enquiry_classified / nurture | qualification | present_offer | Sam |
| mark_closed_lost | qualification | closed_lost | start_nurture | Sam |
| present_offer | qualification | offer_presented | payment_intent_recorded | Sam |
| payment_intent_recorded | offer_presented | payment_pending | payment_cleared | Sam |
| payment_cleared | payment_pending | payment_verified | mark_closed_won | Sam |
| payment_failed | payment_pending | offer_presented | present_offer_or_qualify_lead | Sam |
| mark_closed_won | payment_verified | closed_won | start_onboarding | Sam |
| start_onboarding | closed_won | onboarding_started | issue_privacy_notice | Jordan |
| issue_privacy_notice | onboarding_started | privacy_notice_issued | record_explicit_health_consent | Jordan |
| record_explicit_health_consent | privacy_notice_issued | health_consent_recorded | start_screening | Jordan |
| start_screening | health_consent_recorded | screening | human_ready | Jordan |
| human_ready | screening | ready | draft_programme | Jordan |
| draft_programme | ready | programme_draft | founder_approve_golive | Jordan |
| founder_approve_golive | programme_draft | founder_golive_approved | assign_and_welcome | Founder |
| assign_and_welcome | founder_golive_approved | assigned_welcomed | start_active_coaching | Jordan |
| start_active_coaching | assigned_welcomed | active_coaching | open_weekly_checkin | Jordan |
| open_weekly_checkin | active_coaching | weekly_checkin_open | complete or escalate | Jordan |
| complete_weekly_checkin | weekly_checkin_open | active_coaching | open_weekly_checkin_or_start_retention | Jordan |
| escalate_missed_adherence | weekly_checkin_open / active_coaching | adherence_escalation | resolve_adherence_escalation | Jordan |
| resolve_adherence_escalation | adherence_escalation | active_coaching | open_weekly_checkin | Jordan |
| start_retention | active_coaching | retention_review | offer_renewal_or_request_cancellation | Sam |
| offer_renewal | retention_review | renewal_offered | accept_renewal_or_request_cancellation | Sam |
| accept_renewal | renewal_offered | active_coaching | open_weekly_checkin | Sam |
| request_cancellation | several delivery/commercial states | cancellation_requested | founder_refund_credit_decision | Jordan/Sam |
| founder_refund_credit_decision | cancellation_requested | refund_credit_hold | complete_offboarding | Founder |
| complete_offboarding | refund_credit_hold / cancellation_requested | offboarding | none | Jordan |
| route_blocker | marketing_active / blocked | blocked | owner_resume_from_source_state | Alex |
| social_asset_drafted | marketing_active | social_asset_drafted | social_qa_completed | Taylor |
| social_qa_completed | social_asset_drafted | social_qa_recorded | request_publication | ChatGPT |
| request_publication | social_qa_recorded | publish_eligible | none | Taylor |
| analyse_marketing_cycle | marketing_cycle_idle | marketing_cycle_analyse | generate_marketing_cycle | Taylor |
| generate_marketing_cycle | analyse | generate | produce_marketing_cycle | Taylor |
| produce_marketing_cycle | generate | produce | qa_marketing_cycle | Cursor |
| qa_marketing_cycle | produce | qa | taylor_pass_marketing_cycle | ChatGPT |
| taylor_pass_marketing_cycle | qa | taylor_pass | chatgpt_pass_marketing_cycle | Taylor |
| chatgpt_pass_marketing_cycle | taylor_pass | chatgpt_pass | schedule_marketing_cycle | ChatGPT |
| schedule_marketing_cycle | chatgpt_pass | scheduled | monitor_marketing_cycle | Taylor |
| monitor_marketing_cycle | scheduled | monitor | propose_marketing_learning | Taylor |
| propose_sales_learning | learning_idle | learning_proposal | review_learning_proposal | Sam |
| propose_coaching_learning | learning_idle | learning_proposal | review_learning_proposal | Jordan |
| propose_marketing_learning | learning_idle | learning_proposal | review_learning_proposal | Taylor |
| review_learning_proposal | learning_proposal | learning_reviewed | founder_approve_sop_change | ChatGPT |
| founder_approve_sop_change | learning_reviewed | sop_change_recorded | none | Founder |
