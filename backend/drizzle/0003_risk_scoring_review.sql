ALTER TABLE "email_messages" ADD COLUMN "risk_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "risk_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "scoring" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "review_status" varchar(20) DEFAULT 'New' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "reviewed_by" varchar(320);--> statement-breakpoint
ALTER TABLE "email_posture_checks" ADD COLUMN "risk_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_posture_checks" ADD COLUMN "risk_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_posture_checks" ADD COLUMN "scoring" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "stage" varchar(12) DEFAULT 'typosquat' NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "risk_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "risk_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "scoring" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "confidence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "confidence_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "fraud_themes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "review_status" varchar(20) DEFAULT 'New' NOT NULL;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD COLUMN "reviewed_by" varchar(320);--> statement-breakpoint
CREATE INDEX "ix_phishing_domains_risk" ON "phishing_domains" USING btree ("brand_id","risk_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_phishing_domains_first_seen" ON "phishing_domains" USING btree ("first_seen" DESC NULLS LAST);