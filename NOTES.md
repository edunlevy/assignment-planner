# Project Notes

## Phase 8 — Supabase Setup

### What to do manually (one-time, in the Supabase dashboard)

1. Go to https://supabase.com → create a new project
   - Save the database password somewhere safe (password manager)
   - Wait ~2 min for provisioning

2. Open the **SQL Editor** and run the SQL below (creates the table + RLS)

3. Go to **Project Settings → API**
   - Copy the **Project URL** → paste into `.env` as `EXPO_PUBLIC_SUPABASE_URL`
   - Copy the **anon / public key** → paste into `.env` as `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - The anon key is safe to ship in the app; the service_role key is not — never commit it

4. Verify: in **Table Editor → assignments**, manually insert a row and confirm it appears

---

### SQL — paste this into the Supabase SQL Editor

```sql
-- Create the assignments table
create table public.assignments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  class_name  text        not null,
  title       text        not null,
  due_date    date        not null,
  importance  int         not null default 3,
  status      text        not null default 'not_started',
  series_id   text,                          -- nullable; links recurring occurrences
  created_at  timestamptz not null default now(),

  constraint importance_range check (importance between 1 and 5),
  constraint valid_status     check (status in ('not_started', 'in_progress', 'completed'))
);

-- Enable Row Level Security
alter table public.assignments enable row level security;

-- Policy: users can only read/write their own rows
create policy "Users manage own assignments"
  on public.assignments
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

### Schema notes for Phase 9

| App field  | DB column    | Notes                                      |
|------------|--------------|--------------------------------------------|
| `course`   | `class_name` | Rename on insert/select in Phase 9         |
| `dueDate`  | `due_date`   | App stores YYYY-MM-DD string; DB uses date |
| `seriesId` | `series_id`  | text (app generates timestamp strings)     |
| `id`       | `id`         | App uses string IDs; DB generates UUIDs — Phase 9 will use DB-generated IDs |

The `user_id` column is populated from `supabase.auth.getUser().data.user.id`
in Phase 9 — the app never stores it locally.
