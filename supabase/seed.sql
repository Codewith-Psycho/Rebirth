-- ═══════════════════════════════════════════════════════════════════════════
-- REBIRTH · seed · non-personal reference content only
--
-- This file seeds the quote library and nothing else. It creates no users, no
-- tasks, no goals and no progress of any kind: every statistic the app shows
-- must come from activity the account owner actually performed.
--
-- Run with:  supabase db reset          (local)
--            psql "$DATABASE_URL" -f supabase/seed.sql   (remote)
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- ORIGINAL LINES
--
-- Written for REBIRTH. They are stored with content_type = 'original' and
-- carry no attribution and no source title — the schema's
-- `quote_library_original_unattributed` constraint rejects the row otherwise,
-- so an original line cannot be presented as somebody else's words by accident.
-- ───────────────────────────────────────────────────────────────────────────
insert into public.quote_library (body, content_type, tones, tags) values
  ('You don''t need to finish everything. Start with two minutes.', 'original',
   '{gentle,focused}', '{starting,overwhelm}'),

  ('A smaller step still counts. It counted yesterday too.', 'original',
   '{gentle,reflective}', '{starting,self-compassion}'),

  ('Yesterday is data, not a verdict.', 'original',
   '{reflective,gentle}', '{recovery,setback}'),

  ('Let''s make tomorrow a little easier than today.', 'original',
   '{gentle,focused}', '{planning,recovery}'),

  ('Discipline is just a decision you have already made, made again.', 'original',
   '{stoic,focused}', '{consistency,discipline}'),

  ('The version of you that shows up inconsistently still shows up. Keep the showing up.', 'original',
   '{gentle,reflective}', '{consistency,self-compassion}'),

  ('Motivation is a guest. Structure is the house it visits.', 'original',
   '{stoic,focused}', '{structure,discipline}'),

  ('You are allowed to do this badly today. Badly is still forward.', 'original',
   '{gentle,playful}', '{self-compassion,starting}'),

  ('Rest is not the opposite of progress. It is part of the schedule.', 'original',
   '{reflective,gentle}', '{rest,recovery}'),

  ('The task has not grown. Only the distance you have been standing from it has.', 'original',
   '{focused,gentle}', '{starting,avoidance}'),

  ('Consistency is not a streak. It is a return.', 'original',
   '{reflective,stoic}', '{consistency,recovery}'),

  ('One honest hour beats six imagined ones.', 'original',
   '{focused,stoic}', '{focus,honesty}'),

  ('You do not have to feel ready. Ready is built during, not before.', 'original',
   '{focused,gentle}', '{starting,courage}'),

  ('Some days the win is the work. Some days the win is not quitting the day.', 'original',
   '{gentle,reflective}', '{self-compassion,recovery}'),

  ('Progress rarely announces itself. It accumulates quietly while you are busy being ordinary.', 'original',
   '{reflective,gentle}', '{patience,consistency}'),

  ('Finishing is a skill. So is starting. You can practise either one today.', 'original',
   '{focused,playful}', '{starting,finishing}'),

  ('Do the next small correct thing. That is the whole method.', 'original',
   '{stoic,focused}', '{method,starting}'),

  ('A missed day is a comma. Not a full stop.', 'original',
   '{gentle,playful}', '{recovery,self-compassion}'),

  ('You are not behind. You are on a longer route with better information.', 'original',
   '{reflective,gentle}', '{patience,self-compassion}'),

  ('Choose the version of the day you can actually live, then live that one.', 'original',
   '{gentle,focused}', '{planning,realism}'),

  ('Effort you can measure. Mastery you have to earn slowly and prove.', 'original',
   '{stoic,reflective}', '{honesty,patience}'),

  ('The plan bent. The direction did not have to.', 'original',
   '{reflective,stoic}', '{change,resilience}'),

  ('Being tired is information, not a character flaw.', 'original',
   '{gentle,reflective}', '{energy,self-compassion}'),

  ('Small, repeated, unremarkable. That is what most real progress looks like from the inside.', 'original',
   '{reflective,gentle}', '{patience,consistency}'),

  ('Start before you are interested. Interest usually turns up once you have.', 'original',
   '{focused,playful}', '{starting,procrastination}'),

  ('You kept the promise small enough to keep. That was the smart part.', 'original',
   '{gentle,focused}', '{consistency,self-compassion}')
on conflict (body) do update
  set tones = excluded.tones,
      tags  = excluded.tags;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFIED QUOTATIONS
--
-- Every row here names a character, a series and a checkable locus. Where the
-- English wording differs between the official manga translation and the anime
-- subtitles, `language_note` says so rather than presenting one rendering as
-- the single authoritative text.
--
-- This starter set is deliberately small. Additions should be verified against
-- a primary source (the volume or episode) before being inserted; the
-- `quote_library_verified_has_source` constraint will refuse a verified row
-- that does not carry attribution, title and verification reference.
--
-- NOTE FOR MAINTAINERS: re-verify these against your own copies of the source
-- material before publishing. They are widely reproduced, but "widely
-- reproduced" is not the same as "checked".
-- ───────────────────────────────────────────────────────────────────────────
insert into public.quote_library
  (body, attribution, source_title, language_note, verification_ref, content_type, tones, tags)
values
  (
    'I never go back on my word. That is my ninja way.',
    'Naruto Uzumaki',
    'Naruto',
    'English rendering varies slightly between the Viz manga translation and the anime subtitles; the Japanese phrase is 忍道 (nindō), literally "the way of the ninja".',
    'Naruto (manga, Viz translation) — recurring series motto established in the early Land of Waves chapters; restated throughout the series and in the anime from the early episodes.',
    'verified',
    '{stoic,focused}', '{integrity,commitment}'
  ),
  (
    'I am going to become the King of the Pirates.',
    'Monkey D. Luffy',
    'One Piece',
    'Various official renderings exist ("Pirate King" / "King of the Pirates"); the line is the protagonist''s declaration of intent from the opening chapter.',
    'One Piece, chapter 1, "Romance Dawn" (manga); episode 1 of the anime.',
    'verified',
    '{focused,playful}', '{ambition,identity}'
  ),
  (
    'I am going to be the world''s greatest swordsman.',
    'Roronoa Zoro',
    'One Piece',
    'Translations differ on "greatest" / "strongest"; the vow is made early in the series and referenced repeatedly.',
    'One Piece, early chapters of the Romance Dawn arc (manga); corresponding early episodes of the anime.',
    'verified',
    '{stoic,focused}', '{ambition,discipline}'
  )
on conflict (body) do update
  set attribution      = excluded.attribution,
      source_title     = excluded.source_title,
      language_note    = excluded.language_note,
      verification_ref = excluded.verification_ref,
      content_type     = excluded.content_type,
      tones            = excluded.tones,
      tags             = excluded.tags;
