CREATE TABLE "npc_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"adapter_type" varchar(20) NOT NULL,
	"session_type" varchar(20) NOT NULL,
	"session_ref" varchar(200) NOT NULL,
	"context_key" varchar(200) NOT NULL,
	"last_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider_type" varchar(20) NOT NULL,
	"display_name" varchar(120),
	"auth_method" varchar(20) NOT NULL,
	"credentials_encrypted" text,
	"base_url" text,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(10) DEFAULT 'use' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "npc_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "npcs" ADD COLUMN "adapter_type" varchar(20) DEFAULT 'openclaw' NOT NULL;--> statement-breakpoint
ALTER TABLE "npcs" ADD COLUMN "adapter_config" jsonb;--> statement-breakpoint
ALTER TABLE "npc_sessions" ADD CONSTRAINT "npc_sessions_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_sessions" ADD CONSTRAINT "npc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_resources" ADD CONSTRAINT "provider_resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shares" ADD CONSTRAINT "provider_shares_provider_id_provider_resources_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_shares" ADD CONSTRAINT "provider_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_npc_sessions_npc" ON "npc_sessions" USING btree ("npc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "npc_sessions_npc_user_context_idx" ON "npc_sessions" USING btree ("npc_id","user_id","context_key");--> statement-breakpoint
CREATE INDEX "idx_provider_resources_owner" ON "provider_resources" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_provider_shares_provider" ON "provider_shares" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_shares_provider_user_idx" ON "provider_shares" USING btree ("provider_id","user_id");