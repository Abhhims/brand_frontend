CREATE TYPE "public"."allow_kind" AS ENUM('domain', 'package', 'publisher', 'social_handle', 'email_domain', 'signing_cert');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('logo', 'favicon', 'app_icon');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('screenshot', 'favicon', 'html', 'metadata', 'file', 'ssl', 'whois', 'dns', 'image');--> statement-breakpoint
CREATE TYPE "public"."finding_decision" AS ENUM('New', 'Investigating', 'Confirmed Threat', 'False Positive', 'Legitimate', 'Ignored', 'Resolved');--> statement-breakpoint
CREATE TYPE "public"."finding_stage" AS ENUM('Candidate', 'Finding');--> statement-breakpoint
CREATE TYPE "public"."module_name" AS ENUM('typosquat', 'mx', 'phishing', 'apk', 'rogue_app', 'social', 'documents', 'logo', 'email', 'email_posture', 'dmarc', 'social_media');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('Low', 'Medium', 'High', 'Critical');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('queued', 'running', 'completed', 'partially_completed', 'completed_with_errors', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "brand_allowlist" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" "allow_kind" NOT NULL,
	"value" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"filename" varchar(255) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"phash" varchar(64),
	"dhash" varchar(64),
	"mmh3" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"keywords" varchar[] DEFAULT '{}'::varchar[] NOT NULL,
	"product_terms" varchar[] DEFAULT '{}'::varchar[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"alert_min_level" "risk_level" DEFAULT 'Medium' NOT NULL,
	"auto_scan_enabled" boolean DEFAULT false NOT NULL,
	"auto_scan_frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"auto_scan_runners" varchar[] DEFAULT '{}'::varchar[] NOT NULL,
	"last_auto_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(200) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" "role" DEFAULT 'analyst' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_allowlist" ADD CONSTRAINT "brand_allowlist_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brand_allowlist_brand_kind_value" ON "brand_allowlist" USING btree ("brand_id","kind","value");--> statement-breakpoint
CREATE INDEX "ix_brand_allowlist_brand_id" ON "brand_allowlist" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "ix_brand_assets_brand_id" ON "brand_assets" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ix_users_email" ON "users" USING btree ("email");