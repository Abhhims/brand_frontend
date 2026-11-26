CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"module" "module_name" NOT NULL,
	"trigger" varchar(20) DEFAULT 'schedule' NOT NULL,
	"status" "scan_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apify_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scan_run_id" uuid,
	"brand_id" uuid,
	"source" varchar(80) NOT NULL,
	"actor" varchar(200) NOT NULL,
	"input" jsonb NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"max_items" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"apify_run_id" varchar(40),
	"dataset_id" varchar(40),
	"item_count" integer DEFAULT 0 NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"usage_usd" double precision,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"key" varchar(1000) NOT NULL,
	"platform" varchar(40) NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"url" text NOT NULL,
	"item_id" varchar(300),
	"title" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"author" text,
	"author_handle" varchar(300),
	"author_url" text,
	"author_id" varchar(300),
	"published_at" timestamp with time zone,
	"thumbnail_url" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discovery" varchar(100) NOT NULL,
	"query" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apify_runs" ADD CONSTRAINT "apify_runs_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apify_runs" ADD CONSTRAINT "apify_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_items" ADD CONSTRAINT "social_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_items" ADD CONSTRAINT "social_items_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_scan_runs_brand_id" ON "scan_runs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "ix_scan_runs_created_at" ON "scan_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ix_apify_runs_scan_run_id" ON "apify_runs" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "ix_apify_runs_created_at" ON "apify_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_social_items_brand_key" ON "social_items" USING btree ("brand_id","key");--> statement-breakpoint
CREATE INDEX "ix_social_items_brand_last_seen" ON "social_items" USING btree ("brand_id","last_seen" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_social_items_brand_platform" ON "social_items" USING btree ("brand_id","platform");--> statement-breakpoint
CREATE INDEX "ix_social_items_brand_published" ON "social_items" USING btree ("brand_id","published_at" DESC NULLS LAST);