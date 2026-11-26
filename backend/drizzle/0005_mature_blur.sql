CREATE TABLE "brand_login_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"title" text,
	"screenshot_key" varchar(500),
	"fingerprint" jsonb,
	"form" jsonb,
	"error" text,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_login_pages" ADD CONSTRAINT "brand_login_pages_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_brand_login_pages_brand_id" ON "brand_login_pages" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brand_login_pages_brand_url" ON "brand_login_pages" USING btree ("brand_id","url");