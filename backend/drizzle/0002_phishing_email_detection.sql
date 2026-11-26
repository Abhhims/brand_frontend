CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"fingerprint" varchar(500) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_key" text,
	"channel" varchar(20) DEFAULT 'upload' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"from_address" varchar(320),
	"from_domain" varchar(253),
	"reply_to" varchar(320),
	"return_path" varchar(320),
	"sender_ip" varchar(64),
	"received_at" timestamp with time zone,
	"auth" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verdict" varchar(20) NOT NULL,
	"analysed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_posture_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid,
	"domain" varchar(253) NOT NULL,
	"status" varchar(10) NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phishing_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"domain" varchar(253) NOT NULL,
	"source" varchar(40) NOT NULL,
	"dns_status" varchar(12) NOT NULL,
	"a" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mx" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"similarity" double precision DEFAULT 0 NOT NULL,
	"closest_term" varchar(200),
	"live" boolean,
	"http_status" integer,
	"final_url" text,
	"page_title" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suspected" boolean DEFAULT false NOT NULL,
	"verdict" varchar(60) NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked" timestamp with time zone DEFAULT now() NOT NULL,
	"times_checked" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_posture_checks" ADD CONSTRAINT "email_posture_checks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD CONSTRAINT "phishing_domains_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phishing_domains" ADD CONSTRAINT "phishing_domains_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_messages_brand_fingerprint" ON "email_messages" USING btree ("brand_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ix_email_messages_brand_created" ON "email_messages" USING btree ("brand_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_email_posture_brand_domain" ON "email_posture_checks" USING btree ("brand_id","domain","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_phishing_domains_brand_domain" ON "phishing_domains" USING btree ("brand_id","domain");--> statement-breakpoint
CREATE INDEX "ix_phishing_domains_brand_checked" ON "phishing_domains" USING btree ("brand_id","last_checked" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_phishing_domains_suspected" ON "phishing_domains" USING btree ("brand_id","suspected");