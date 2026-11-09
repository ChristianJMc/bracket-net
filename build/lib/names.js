// Team-name matching shared by every source: Wikipedia, Kaggle, ESPN -> Barttorvik names.

const ALIASES = {
  'uconn': 'Connecticut', 'ole miss': 'Mississippi', 'nc st': 'N.C. State', 'unc': 'North Carolina',
  'byu': 'BYU', 'vcu': 'VCU', 'ucf': 'UCF', 'lsu': 'LSU', 'tcu': 'TCU', 'smu': 'SMU', 'usc': 'USC', 'ucla': 'UCLA',
  'unlv': 'UNLV', 'utep': 'UTEP', 'uab': 'UAB', 'liu': 'LIU', 'liu brooklyn': 'LIU', 'long island': 'LIU',
  'pitt': 'Pittsburgh', 'umass': 'Massachusetts', 'uc santa barbara': 'UC Santa Barbara',
  'cal st fullerton': 'Cal St. Fullerton', 'cal st bakersfield': 'Cal St. Bakersfield', 'csu bakersfield': 'Cal St. Bakersfield',
  'st marys': "Saint Mary's", 'st josephs': "Saint Joseph's", 'st louis': 'Saint Louis', 'st peters': "Saint Peter's",
  'st johns': "St. John's", 'st bonaventure': 'St. Bonaventure', 'mount st marys': "Mount St. Mary's",
  'miami fl': 'Miami FL', 'miami oh': 'Miami OH', 'miami ohio': 'Miami OH', 'loyola chicago': 'Loyola Chicago',
  'loyola md': 'Loyola MD', 'loyola maryland': 'Loyola MD', 'texas am': 'Texas A&M', 'texas am corpus christi': 'Texas A&M Corpus Chris',
  'am corpus christi': 'Texas A&M Corpus Chris', 'tamu cc': 'Texas A&M Corpus Chris', 'florida am': 'Florida A&M',
  'arkansas pine bluff': 'Arkansas Pine Bluff', 'arkansas little rock': 'Little Rock', 'ualr': 'Little Rock', 'little rock': 'Little Rock',
  'ut arlington': 'UT Arlington', 'texas arlington': 'UT Arlington', 'ucsb': 'UC Santa Barbara', 'umbc': 'UMBC',
  'unc asheville': 'UNC Asheville', 'unc greensboro': 'UNC Greensboro', 'unc wilmington': 'UNC Wilmington', 'uncw': 'UNC Wilmington',
  'etsu': 'East Tennessee St.', 'east tennessee st': 'East Tennessee St.', 'siu edwardsville': 'SIU Edwardsville', 'siue': 'SIU Edwardsville',
  'fdu': 'Fairleigh Dickinson', 'fau': 'Florida Atlantic', 'fgcu': 'Florida Gulf Coast', 'iupui': 'IUPUI',
  'detroit': 'Detroit Mercy', 'detroit mercy': 'Detroit Mercy', 'cal poly': 'Cal Poly', 'boston university': 'Boston University',
  'louisiana lafayette': ['Louisiana Lafayette', 'Louisiana'], 'louisiana': ['Louisiana Lafayette', 'Louisiana'], 'ul lafayette': ['Louisiana Lafayette', 'Louisiana'],
  'louisiana monroe': 'Louisiana Monroe', 'southern miss': 'Southern Miss', 'western kentucky': 'Western Kentucky',
  'njit': 'NJIT', 'grambling': 'Grambling St.', 'grambling st': 'Grambling St.', 'college of charleston': 'College of Charleston',
  'charleston': 'College of Charleston', 'mcneese': 'McNeese St.', 'mcneese st': 'McNeese St.', 'nicholls': 'Nicholls St.',
  'nicholls st': 'Nicholls St.', 'southeast missouri st': 'Southeast Missouri St.', 'semo': 'Southeast Missouri St.',
  'texas southern': 'Texas Southern', 'prairie view am': 'Prairie View A&M', 'prairie view': 'Prairie View A&M',
  'alabama am': 'Alabama A&M', 'north carolina at': 'North Carolina A&T', 'nc at': 'North Carolina A&T',
  'nc central': 'North Carolina Central', 'north carolina central': 'North Carolina Central', 'uc irvine': 'UC Irvine',
  'uc davis': 'UC Davis', 'uc san diego': 'UC San Diego', 'csun': 'Cal St. Northridge', 'cal st northridge': 'Cal St. Northridge',
  'omaha': 'Nebraska Omaha', 'nebraska omaha': 'Nebraska Omaha', 'purdue fort wayne': 'Purdue Fort Wayne', 'ipfw': 'Purdue Fort Wayne',
  'umkc': 'UMKC', 'kansas city': 'UMKC', 'wright st': 'Wright St.', 'saint francis': 'Saint Francis', 'st francis pa': 'Saint Francis',
  'mississippi valley st': 'Mississippi Valley St.', 'stephen f austin': 'Stephen F. Austin', 'sfa': 'Stephen F. Austin',
  'gardner webb': 'Gardner Webb', 'bethune cookman': 'Bethune Cookman', 'winston salem st': 'Winston Salem St.',
  'queens': 'Queens', 'tennessee martin': 'Tennessee Martin', 'ut martin': 'Tennessee Martin', 'utsa': 'UTSA',
  'texas rio grande valley': 'UT Rio Grande Valley', 'utrgv': 'UT Rio Grande Valley', 'ole miss rebels': 'Mississippi',
  'cal baptist': 'Cal Baptist', 'california baptist': 'Cal Baptist', 'st thomas': 'St. Thomas', 'st thomas mn': 'St. Thomas',
  'central connecticut': 'Central Connecticut', 'central connecticut st': 'Central Connecticut', 'albany': 'Albany',
  'ualbany': 'Albany', 'hawaii': 'Hawaii', 'hawai i': 'Hawaii', 'penn': 'Penn', 'pennsylvania': 'Penn',
  // ESPN player box score school names
  'american university': 'American', 'sam houston': ['Sam Houston St.', 'Sam Houston'], 'long island university': 'LIU', 'queens university': 'Queens',
};

function norm(s) {
  return s.toLowerCase()
    .replace(/[’'`.,()&]/g, '').replace(/[-–—]/g, ' ')
    .replace(/\bsaint\b/g, 'st').replace(/\bstate\b/g, 'st')
    .replace(/\s+/g, ' ').trim();
}

// Wikipedia link titles look like "2023–24 Miami Hurricanes men's basketball team".
function linkHint(link) {
  if (!link) return null;
  if (/Miami Hurricanes/.test(link)) return 'Miami FL';
  if (/Miami RedHawks/.test(link)) return 'Miami OH';
  if (/Loyola Ramblers/.test(link)) return 'Loyola Chicago';
  if (/Loyola Greyhounds/.test(link)) return 'Loyola MD';
  if (/USC Trojans|Southern California Trojans/.test(link)) return 'USC';
  if (/Saint Francis Red Flash/.test(link)) return 'Saint Francis';
  return null;
}

function makeMatcher(bartNames) {
  const byNorm = new Map();
  for (const n of bartNames) byNorm.set(norm(n), n);
  return (text, link) => {
    const hint = linkHint(link);
    if (hint && bartNames.has(hint)) return hint;
    const k = norm(text);
    if (byNorm.has(k)) return byNorm.get(k);
    const viaAlias = (key) => [].concat(ALIASES[key] || []).find(n => bartNames.has(n));
    if (viaAlias(k)) return viaAlias(k);
    if (link) {
      // Try the school part of the link title: "2023–24 X Y men's basketball team" -> drop season and nickname
      const t = link.replace(/^\d{4}[–-]\d{2}\s+/, '').replace(/ men's basketball team$/, '');
      const words = t.split(' ');
      for (let i = words.length - 1; i >= 1; i--) {
        const cand = norm(words.slice(0, i).join(' '));
        if (byNorm.has(cand)) return byNorm.get(cand);
        if (viaAlias(cand)) return viaAlias(cand);
      }
    }
    return null;
  };
}

module.exports = { ALIASES, norm, linkHint, makeMatcher };
