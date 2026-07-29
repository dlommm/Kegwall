/**
 * Beer style names for the beers form's offline style autocomplete (`StyleAutocomplete`,
 * `routes/admin/StyleAutocomplete.tsx`). Replaces the removed Untappd search sheet's
 * style-metadata autofill (Untappd's v4 API has not granted new developer credentials in
 * years, and the search sheet it powered was removed entirely) with a purely local,
 * offline substring-filtered list — no network round-trip, no API key, works the same on
 * day one for every install.
 *
 * The 121 numbered entries below are every individual style name from the BJCP (Beer
 * Judge Certification Program) 2021 Style Guidelines, categories 1-34, in the guidelines'
 * own category order (source: https://styles.bjcp.org/bjcp-2021-beer , mirroring
 * https://www.bjcp.org/style/2021/beer/ — the 2021 guidelines are the current BJCP
 * edition as of this writing). A short "common extras" tail adds a handful of widely used
 * colloquial/market names that are NOT their own BJCP subcategory (e.g. "New England IPA"
 * is commercially ubiquitous but falls under BJCP's "Hazy IPA"), so a beer described that
 * way is still one keystroke away from a suggestion.
 *
 * This list is a convenience autofill, not a validator — `StyleAutocomplete` always
 * allows free text, so a custom or house style name the list doesn't cover is never
 * blocked (same "suggest, never gate" contract `BreweryAutocomplete` already has for
 * brewery names not covered by Open Brewery DB).
 */
export const BEER_STYLES: string[] = [
  // 1. Standard American Beer
  'American Light Lager',
  'American Lager',
  'Cream Ale',
  'American Wheat Beer',
  // 2. International Lager
  'International Pale Lager',
  'International Amber Lager',
  'International Dark Lager',
  // 3. Czech Lager
  'Czech Pale Lager',
  'Czech Premium Pale Lager',
  'Czech Amber Lager',
  'Czech Dark Lager',
  // 4. Pale Malty European Lager
  'Munich Helles',
  'Festbier',
  'Helles Bock',
  // 5. Pale Bitter European Beer
  'German Leichtbier',
  'Kölsch',
  'German Helles Exportbier',
  'German Pils',
  // 6. Amber Malty European Lager
  'Märzen',
  // 7. Amber Bitter European Beer
  'Rauchbier',
  'Dunkles Bock',
  'Vienna Lager',
  'Altbier',
  // 8. Dark European Lager
  'Munich Dunkel',
  'Schwarzbier',
  // 9. Strong European Beer
  'Doppelbock',
  'Eisbock',
  'Baltic Porter',
  // 10. German Wheat Beer
  'Weissbier',
  'Dunkles Weissbier',
  'Weizenbock',
  // 11. British Bitter
  'Ordinary Bitter',
  'Best Bitter',
  'Strong Bitter',
  // 12. Pale Commonwealth Beer
  'British Golden Ale',
  'Australian Sparkling Ale',
  'English IPA',
  // 13. Brown British Beer
  'Dark Mild',
  'British Brown Ale',
  'English Porter',
  // 14. Scottish Ale
  'Scottish Light',
  'Scottish Heavy',
  'Scottish Export',
  // 15. Irish Beer
  'Irish Red Ale',
  'Irish Stout',
  'Irish Extra Stout',
  // 16. Dark British Beer
  'Sweet Stout',
  'Oatmeal Stout',
  'Tropical Stout',
  'Foreign Extra Stout',
  // 17. Strong British Ale
  'British Strong Ale',
  'Old Ale',
  'Wee Heavy',
  'English Barleywine',
  // 18. Pale American Ale
  'Blonde Ale',
  'American Pale Ale',
  // 19. Amber and Brown American Beer
  'American Amber Ale',
  'California Common',
  'American Brown Ale',
  // 20. American Porter and Stout
  'American Porter',
  'American Stout',
  'Imperial Stout',
  // 21. IPA
  'American IPA',
  'Specialty IPA',
  'Hazy IPA',
  'Double IPA',
  // 22. Strong American Ale
  'American Strong Ale',
  'American Barleywine',
  'Wheatwine',
  // 23. European Sour Ale
  'Berliner Weisse',
  'Flanders Red Ale',
  'Oud Bruin',
  // 24. Belgian Ale
  'Lambic',
  'Gueuze',
  'Fruit Lambic',
  'Gose',
  'Witbier',
  'Belgian Pale Ale',
  'Bière de Garde',
  // 25. Strong Belgian Ale
  'Belgian Blond Ale',
  'Saison',
  'Belgian Golden Strong Ale',
  // 26. Monastic Ale
  'Belgian Single',
  'Belgian Dubbel',
  'Belgian Tripel',
  'Belgian Dark Strong Ale',
  // 27. Historical Beer
  'Kellerbier',
  'Kentucky Common',
  'Lichtenhainer',
  'London Brown Ale',
  'Piwo Grodziskie',
  'Pre-Prohibition Lager',
  'Pre-Prohibition Porter',
  'Roggenbier',
  'Sahti',
  // 28. American Wild Ale
  'Brett Beer',
  'Mixed-Fermentation Sour Beer',
  'Wild Specialty Beer',
  'Straight Sour Beer',
  // 29. Fruit Beer
  'Fruit Beer',
  'Fruit and Spice Beer',
  'Specialty Fruit Beer',
  'Grape Ale',
  // 30. Spiced Beer
  'Spice, Herb, or Vegetable Beer',
  'Autumn Seasonal Beer',
  'Winter Seasonal Beer',
  'Specialty Spice Beer',
  // 31. Alternative Fermentables Beer
  'Alternative Grain Beer',
  'Alternative Sugar Beer',
  // 32. Smoked Beer
  'Classic Style Smoked Beer',
  'Specialty Smoked Beer',
  // 33. Wood Beer
  'Wood-Aged Beer',
  'Specialty Wood-Aged Beer',
  // 34. Specialty Beer
  'Commercial Specialty Beer',
  'Mixed-Style Beer',
  'Experimental Beer',
  'Dorada Pampeana',
  'IPA Argenta',
  'Italian Grape Ale',
  'Catharina Sour',
  'New Zealand Pilsner',

  // --- Common extras: widely used colloquial/market names that aren't their own BJCP
  // subcategory (each maps to an official style above), included so a beer described the
  // popular way still surfaces a suggestion. Not authoritative BJCP style names.
  'New England IPA',
  'West Coast IPA',
  'Session IPA',
  'Black IPA',
  'Milk Stout',
  'Farmhouse Ale',
  'Sour Ale',
  'Pilsner',
];
