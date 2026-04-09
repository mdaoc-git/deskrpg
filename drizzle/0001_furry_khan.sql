CREATE TABLE "channel_gateway_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"gateway_id" uuid NOT NULL,
	"bound_by_user_id" uuid NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"base_url" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"paired_device_id" text,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" varchar(40),
	"last_validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(32) DEFAULT 'use' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_gateway_bindings" ADD CONSTRAINT "channel_gateway_bindings_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_gateway_bindings" ADD CONSTRAINT "channel_gateway_bindings_gateway_id_gateway_resources_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateway_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_gateway_bindings" ADD CONSTRAINT "channel_gateway_bindings_bound_by_user_id_users_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_resources" ADD CONSTRAINT "gateway_resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_shares" ADD CONSTRAINT "gateway_shares_gateway_id_gateway_resources_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateway_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_shares" ADD CONSTRAINT "gateway_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_gateway_bindings_gateway_id" ON "channel_gateway_bindings" USING btree ("gateway_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_gateway_bindings_channel_idx" ON "channel_gateway_bindings" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_gateway_resources_owner_user_id" ON "gateway_resources" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_gateway_shares_gateway_id" ON "gateway_shares" USING btree ("gateway_id");--> statement-breakpoint
CREATE INDEX "idx_gateway_shares_user_id" ON "gateway_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_shares_gateway_user_idx" ON "gateway_shares" USING btree ("gateway_id","user_id");