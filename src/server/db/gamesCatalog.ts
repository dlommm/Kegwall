// The 100-game drinking-games catalog (WebUI redesign 5d). Seeded idempotently by name into
// the `games` table (db/games.ts `seedGames`). Names + category groupings are from the design
// doc's index; premises are authored here (bar/party classics). Every game is tagged with a
// tracking mode (AUTO sensor-verified / TABLET tap-logged / HYBRID) that drives how the wall
// strip + kiosk score it.

export type GameCategory =
  | 'volume' | 'precision' | 'cardboard' | 'party' | 'team' | 'season' | 'chance' | 'mind';
export type GameTracking = 'AUTO' | 'TABLET' | 'HYBRID';
export type GameMetric = 'oz' | 'pours' | 'quality' | 'manual_points' | 'time';
export type GameWinRule =
  | 'first_to_target' | 'highest' | 'lowest' | 'closest' | 'prediction' | 'survival';

export interface GameSeed {
  name: string;
  category: GameCategory;
  premise: string;
  tracking: GameTracking;
  metric: GameMetric;
  winRule: GameWinRule;
  duration: string;
  minPlayers: number;
  maxPlayers: number | null;
}

const g = (
  name: string, category: GameCategory, tracking: GameTracking, metric: GameMetric,
  winRule: GameWinRule, duration: string, minPlayers: number, maxPlayers: number | null,
  premise: string,
): GameSeed => ({
  name, category, premise, tracking, metric, winRule, duration, minPlayers, maxPlayers,
});

export const GAMES_CATALOG: GameSeed[] = [
  // --- Volume & Races (15) --------------------------------------------------
  g('Keg Race', 'volume', 'AUTO', 'oz', 'first_to_target', '~30 min', 2, 8, 'First to pour a set volume from the taps takes the checkered flag.'),
  g('Century Club', 'volume', 'AUTO', 'oz', 'first_to_target', '1 night', 1, null, 'Log 100 oz across the night — pace yourself into the club.'),
  g('Das Boot Relay', 'volume', 'AUTO', 'oz', 'first_to_target', '~20 min', 4, 12, 'Teams pass the boot; first crew to empty their target volume wins.'),
  g('Last Keg Standing', 'volume', 'AUTO', 'oz', 'survival', '1 night', 2, null, 'Keep pouring — the last drinker still going when a keg kicks wins.'),
  g('Split the Half', 'volume', 'AUTO', 'oz', 'first_to_target', '~45 min', 2, 2, 'Two drinkers race to split a half-barrel evenly and first.'),
  g('Gallon Weekend', 'volume', 'AUTO', 'oz', 'highest', 'weekend', 1, null, 'Most total volume poured across the weekend takes the crown.'),
  g('Photo Finish', 'volume', 'AUTO', 'oz', 'closest', '~15 min', 2, 8, 'Closest to the exact target volume without going over wins.'),
  g('The Ladder', 'volume', 'AUTO', 'oz', 'survival', '~30 min', 2, 8, 'Each round the target volume steps up; last to keep pace survives.'),
  g('Descent', 'volume', 'AUTO', 'oz', 'survival', '~30 min', 2, 8, 'Start big and pour smaller each round; miss the step and you are out.'),
  g('Tortoise & Hare', 'volume', 'AUTO', 'oz', 'highest', '1 hour', 2, null, 'Steady sippers versus chuggers — highest volume at the final bell.'),
  g('Tap Tour', 'volume', 'HYBRID', 'pours', 'first_to_target', '1 night', 1, null, 'First to pour at least once from every active tap wins the tour.'),
  g('Halfway There', 'volume', 'AUTO', 'oz', 'closest', '~20 min', 2, 8, 'First to reach exactly half a keg’s worth, on the nose.'),
  g('The Regular', 'volume', 'AUTO', 'pours', 'highest', 'month', 1, null, 'Most pours logged this month earns the title of "the Regular".'),
  g('Happy Hour Sprint', 'volume', 'AUTO', 'oz', 'highest', '1 hour', 1, null, 'Most volume poured inside a single hour window.'),
  g('Negative Split', 'volume', 'AUTO', 'oz', 'highest', '1 night', 1, null, 'Pour more in the back half than the front — biggest split wins.'),

  // --- Precision & Skill (15) -----------------------------------------------
  g('Perfect Pint', 'precision', 'AUTO', 'oz', 'closest', '~10 min', 1, null, 'Pour as close to exactly 16 oz as your hands allow.'),
  g('Steady Hands', 'precision', 'AUTO', 'quality', 'highest', '~10 min', 1, null, 'Highest pour-quality (flow-consistency) score wins.'),
  g('Blind Draft', 'precision', 'AUTO', 'oz', 'closest', '~10 min', 1, null, 'Pour the target volume with your eyes closed; closest wins.'),
  g('Foam Free', 'precision', 'AUTO', 'quality', 'highest', '~10 min', 1, null, 'Cleanest pour — best quality with the least foam.'),
  g('The Sommelier', 'precision', 'TABLET', 'manual_points', 'highest', '~30 min', 2, null, 'Identify the beer from a blind pour; most correct calls wins.'),
  g('Déjà Pour', 'precision', 'AUTO', 'oz', 'closest', '~10 min', 1, null, 'Match your previous pour’s volume exactly.'),
  g('The Metronome', 'precision', 'HYBRID', 'time', 'closest', '~10 min', 1, null, 'Pour a set volume in a set time — closest to both.'),
  g('Golden Ratio', 'precision', 'AUTO', 'quality', 'highest', '~10 min', 1, null, 'Nail the ideal head-to-beer ratio, judged by pour quality.'),
  g('Slowest Hand', 'precision', 'HYBRID', 'time', 'highest', '~10 min', 2, 8, 'Pour the target volume the slowest without ever stopping.'),
  g('Speedrun', 'precision', 'AUTO', 'time', 'lowest', '~10 min', 1, null, 'Pour the target volume the fastest — cleanly, no spills.'),
  g('Bullseye Board', 'precision', 'AUTO', 'oz', 'highest', '~20 min', 1, null, 'Hit consecutive volume targets; most bullseyes wins.'),
  g('Q Streak', 'precision', 'AUTO', 'quality', 'highest', '1 night', 1, null, 'Longest streak of high-quality pours in a row.'),
  g('Feather Finish', 'precision', 'AUTO', 'oz', 'closest', '~10 min', 1, null, 'Stop closest to the target with the gentlest finish.'),
  g('Mirror Match', 'precision', 'AUTO', 'oz', 'closest', '~10 min', 2, 2, 'Two players try to pour identical volumes; smallest gap wins.'),
  g('Two Hands One Boot', 'precision', 'AUTO', 'quality', 'highest', '~15 min', 1, null, 'Fill the boot two-handed; cleanest full pour wins.'),

  // --- Card & Board Tie-ins (15) --------------------------------------------
  g('Kings Cup Verified', 'cardboard', 'HYBRID', 'pours', 'survival', '~45 min', 3, 12, 'Classic Kings Cup — the tap verifies every drink the card demands.'),
  g('Catan: Longest Sip', 'cardboard', 'TABLET', 'manual_points', 'highest', '~90 min', 3, 6, 'Whoever holds Longest Road sips; log it live as it changes hands.'),
  g('Poker Pints', 'cardboard', 'TABLET', 'manual_points', 'highest', '~60 min', 2, 8, 'Ante in ounces; the best hand takes the whole pot.'),
  g('Uno Undo', 'cardboard', 'TABLET', 'pours', 'survival', '~30 min', 2, 8, 'Reverse and Skip cards trigger pours; last with beer wins.'),
  g('Beeropoly', 'cardboard', 'TABLET', 'oz', 'highest', '~90 min', 2, 6, 'Land on a property, pour the rent.'),
  g('Blackjack Taps', 'cardboard', 'TABLET', 'manual_points', 'closest', '~30 min', 2, 7, 'Bust and you pour; closest to 21 sips takes it.'),
  g('Chess Clock', 'cardboard', 'TABLET', 'time', 'lowest', '~40 min', 2, 2, 'Your clock runs while you sip; win the match on time.'),
  g('Jenga Jitters', 'cardboard', 'TABLET', 'pours', 'survival', '~30 min', 2, 8, 'Pull a block, read the pour dare written on it.'),
  g('Risk: Liquid Borders', 'cardboard', 'TABLET', 'manual_points', 'highest', '~2 hours', 3, 6, 'Conquer territories; pour for every army you lose.'),
  g('Scrabble Sips', 'cardboard', 'TABLET', 'oz', 'highest', '~60 min', 2, 4, 'Score a word, pour a proportional amount.'),
  g('Cribbage Pegs & Pints', 'cardboard', 'TABLET', 'pours', 'highest', '~45 min', 2, 4, 'Every fifteen pegs, a pour.'),
  g('Darts: Round the Clock', 'cardboard', 'TABLET', 'pours', 'survival', '~30 min', 2, 8, 'Miss your number, take a sip.'),
  g('Dominoes Draft', 'cardboard', 'TABLET', 'pours', 'highest', '~45 min', 2, 4, 'Draw from the boneyard, draw from the tap.'),
  g('Battleship Bilge', 'cardboard', 'TABLET', 'pours', 'survival', '~30 min', 2, 2, 'A hit sinks a sip on your opponent.'),
  g('Mario Kart Pit Stop', 'cardboard', 'TABLET', 'pours', 'survival', '~40 min', 2, 4, 'Last place each race makes a pit-stop pour.'),

  // --- Party & Social (15) --------------------------------------------------
  g('Roulette Tap', 'party', 'HYBRID', 'pours', 'survival', '~30 min', 3, 12, 'A spin picks a tap and a pourer at random.'),
  g('Power Hour', 'party', 'HYBRID', 'pours', 'survival', '1 hour', 2, null, 'A pour every minute for an hour; survivors win.'),
  g('Flip Cup Standings', 'party', 'TABLET', 'manual_points', 'highest', '~30 min', 4, 12, 'Team flip-cup; log each round’s wins on the kiosk.'),
  g('Trivia Tap', 'party', 'TABLET', 'manual_points', 'highest', '~45 min', 2, null, 'Wrong answer, you pour — most points still standing wins.'),
  g('Wheel of Foam', 'party', 'TABLET', 'pours', 'highest', '~30 min', 2, 10, 'Spin the wheel for your pour dare.'),
  g('Karaoke Courage', 'party', 'TABLET', 'pours', 'lowest', '~60 min', 2, null, 'Sing to skip a pour; chicken out and drink.'),
  g('The Toastmaster', 'party', 'TABLET', 'manual_points', 'highest', '~30 min', 3, 12, 'No toast, no sip — the best toast wins the round.'),
  g('Accent Hour', 'party', 'TABLET', 'pours', 'lowest', '1 hour', 2, 10, 'Break character, take a pour.'),
  g('Silent Pour', 'party', 'TABLET', 'pours', 'lowest', '~20 min', 2, 10, 'Talk during the round and you drink.'),
  g('The Understudy', 'party', 'TABLET', 'pours', 'highest', '1 night', 2, null, 'Stand in for a missing friend’s pours.'),
  g('First & Last', 'party', 'TABLET', 'pours', 'highest', '1 night', 3, null, 'First and last to arrive share the round’s pours.'),
  g('Costume Clause', 'party', 'TABLET', 'pours', 'lowest', '1 night', 2, null, 'Out of costume, you pour.'),
  g('Compliment Cascade', 'party', 'TABLET', 'pours', 'lowest', '~20 min', 3, 12, 'No compliment on your turn and you drink.'),
  g('The Ghost', 'party', 'TABLET', 'pours', 'survival', '~30 min', 3, 8, 'An empty seat "drinks" — the table covers its pours.'),
  g('Round Robin Rounds', 'party', 'TABLET', 'pours', 'highest', '1 night', 3, 10, 'Everyone buys a round in turn; do not miss yours.'),

  // --- Team & Tournament (10) -----------------------------------------------
  g('Tap Draft League', 'team', 'AUTO', 'oz', 'highest', 'season', 4, null, 'Draft pourers into teams; total volume wins the season.'),
  g('Relay Nations', 'team', 'AUTO', 'oz', 'first_to_target', '~30 min', 4, 16, 'National teams relay pours to a target.'),
  g('Pint Pong Playoffs', 'team', 'TABLET', 'manual_points', 'highest', '~2 hours', 4, 16, 'Bracketed pint-pong; log every match result.'),
  g('The Pennant', 'team', 'AUTO', 'oz', 'highest', 'season', 4, null, 'Season-long team volume race for the pennant.'),
  g('Home & Away', 'team', 'AUTO', 'oz', 'highest', '2 nights', 4, 16, 'Two-leg team tie; aggregate volume wins.'),
  g('Captains’ Gauntlet', 'team', 'AUTO', 'oz', 'highest', '~30 min', 2, 8, 'Captains pour head-to-head for bonus points.'),
  g('Salary Cap', 'team', 'AUTO', 'oz', 'highest', 'season', 4, null, 'Build a team under a volume cap; efficiency wins.'),
  g('The Ashes', 'team', 'AUTO', 'oz', 'highest', 'series', 2, 12, 'A best-of series between two crews for the urn.'),
  g('Pinch Pourer', 'team', 'AUTO', 'oz', 'highest', '~30 min', 3, 12, 'Sub in a ringer for one clutch pour.'),
  g('Promotion & Relegation', 'team', 'AUTO', 'oz', 'highest', 'season', 6, null, 'Bottom team drops a division each season.'),

  // --- Season & Long-haul (10) ----------------------------------------------
  g('The Marathon', 'season', 'AUTO', 'pours', 'first_to_target', 'season', 1, null, '26.2 pours across the season — finish the distance.'),
  g('Style Passport', 'season', 'HYBRID', 'manual_points', 'first_to_target', 'season', 1, null, 'Pour every beer style on the board this season.'),
  g('The Streak', 'season', 'AUTO', 'pours', 'highest', 'season', 1, null, 'Longest run of consecutive days with a pour.'),
  g('Keg Prophet', 'season', 'TABLET', 'manual_points', 'prediction', 'per keg', 1, null, 'Predict the exact kick date of a keg.'),
  g('The Tithe', 'season', 'AUTO', 'oz', 'survival', 'month', 1, null, 'Pour 10% more than last month to stay in the running.'),
  g('Four Seasons', 'season', 'AUTO', 'oz', 'highest', 'year', 1, null, 'Top the board in all four seasons.'),
  g('Birthday Boot', 'season', 'AUTO', 'oz', 'first_to_target', '1 night', 1, null, 'Finish the boot on your birthday.'),
  g('The Archivist', 'season', 'HYBRID', 'manual_points', 'highest', 'year', 1, null, 'Rate the most distinct beers over the year.'),
  g('Attendance Trophy', 'season', 'AUTO', 'pours', 'highest', 'season', 1, null, 'Most distinct days present with a pour.'),
  g('Century Season', 'season', 'AUTO', 'pours', 'first_to_target', 'season', 1, null, '100 pours before the season ends.'),

  // --- Chance & Chaos (10) --------------------------------------------------
  g('Pour Lottery', 'chance', 'TABLET', 'manual_points', 'prediction', '~20 min', 3, null, 'A random pourer wins the pot each round.'),
  g('Mystery Multiplier', 'chance', 'HYBRID', 'oz', 'highest', '~30 min', 2, 10, 'Your pour counts a random multiple toward the total.'),
  g('Thunderstruck', 'chance', 'TABLET', 'pours', 'survival', '1 song', 2, 12, 'Every "thunder" in the song, you pour.'),
  g('Red Light Green Light', 'chance', 'TABLET', 'pours', 'survival', '~20 min', 3, 12, 'Pour on green, freeze on red — caught means drink.'),
  g('The Swap', 'chance', 'HYBRID', 'oz', 'highest', '~30 min', 2, 8, 'At random the leader and the loser swap totals.'),
  g('Dice Duel', 'chance', 'HYBRID', 'oz', 'first_to_target', '~20 min', 2, 8, 'Roll to set your pour target each round.'),
  g('Musical Taps', 'chance', 'TABLET', 'pours', 'survival', '~20 min', 3, 12, 'When the music stops, the tapless pour.'),
  g('Coin Flip Climb', 'chance', 'HYBRID', 'oz', 'first_to_target', '~20 min', 2, 8, 'Heads doubles, tails halves your next target.'),
  g('The Bomb', 'chance', 'TABLET', 'pours', 'survival', '~15 min', 3, 12, 'A hidden timer; whoever’s pouring when it blows loses.'),
  g('Fortune Foam', 'chance', 'TABLET', 'pours', 'highest', '~30 min', 2, 10, 'Draw a fortune card that warps your next pour.'),

  // --- Mind & Trivia (10) ---------------------------------------------------
  g('Pub Quiz Royale', 'mind', 'TABLET', 'manual_points', 'survival', '~45 min', 2, null, 'Last quizzer standing; wrong answers pour.'),
  g('Liar’s Pour', 'mind', 'TABLET', 'manual_points', 'highest', '~30 min', 3, 10, 'Bluff your volume; called liars drink.'),
  g('The Estimator', 'mind', 'AUTO', 'oz', 'closest', '1 night', 2, null, 'Guess the group’s total volume; closest wins.'),
  g('Memory Lane', 'mind', 'TABLET', 'manual_points', 'highest', '~20 min', 2, 8, 'Recall the pour order; a miss costs a sip.'),
  g('Name That Brew', 'mind', 'TABLET', 'manual_points', 'highest', '~30 min', 2, null, 'Name the beer from a single clue.'),
  g('Math Pour', 'mind', 'TABLET', 'manual_points', 'highest', '~20 min', 2, 8, 'Solve for your pour target; wrong math over-pours.'),
  g('Backwards Bar', 'mind', 'TABLET', 'pours', 'lowest', '~20 min', 2, 10, 'Order and pour in reverse; slip up and drink.'),
  g('The Curator', 'mind', 'TABLET', 'manual_points', 'highest', '~30 min', 2, 8, 'Assemble the best themed flight, judged by the table.'),
  g('Beer Geography', 'mind', 'TABLET', 'manual_points', 'highest', '~30 min', 2, 8, 'Place the brewery on the map; misses pour.'),
  g('Prohibition', 'mind', 'TABLET', 'pours', 'lowest', '1 night', 3, null, 'Say a banned word and you pour.'),
];
