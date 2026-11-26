ALTER TABLE "social_items" ADD COLUMN "analysed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "relevant" boolean;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "risk_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "risk_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "signals" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "scoring" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "confidence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "confidence_level" varchar(10) DEFAULT 'Low' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "reasons" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "logo_comparison" jsonb;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "review_status" varchar(20) DEFAULT 'New' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_items" ADD COLUMN "reviewed_by" varchar(320);--> statement-breakpoint
CREATE INDEX "ix_social_items_brand_risk" ON "social_items" USING btree ("brand_id","risk_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_social_items_brand_relevant_level" ON "social_items" USING btree ("brand_id","relevant","risk_level");