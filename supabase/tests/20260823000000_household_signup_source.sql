begin;

select plan(2);

select has_column('public', 'households', 'signup_source', 'households stores signup source');

select has_function(
  'public',
  'create_household',
  array['text', 'text', 'text', 'text', 'text', 'text', 'text'],
  'create_household accepts signup source'
);

select * from finish();

rollback;
