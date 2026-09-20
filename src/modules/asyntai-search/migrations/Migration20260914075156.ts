import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260914075156 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "asyntai_setting" drop constraint if exists "asyntai_setting_name_unique";`);
    this.addSql(`create table if not exists "asyntai_setting" ("id" text not null, "name" text not null, "value" text not null default '', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "asyntai_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_asyntai_setting_name_unique" ON "asyntai_setting" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_asyntai_setting_deleted_at" ON "asyntai_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "asyntai_setting" cascade;`);
  }

}
