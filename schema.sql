create table if not exists public.weather_daily (
 signal_id text not null,
 record_date date not null,
 source_url text not null,
 source_observed_at timestamptz not null,
 normalized_value double precision not null,
 unit text not null,
 fetched_at timestamptz not null,
 primary key(signal_id,record_date)
);
alter table public.weather_daily enable row level security;
revoke all on public.weather_daily from anon, authenticated;
