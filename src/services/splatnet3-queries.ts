/** SplatNet 3 persisted-query names used for diagnostics. */
export const SPLATNET3_QUERY_NAMES: Record<string, string> = {
    // Stage Schedules
    '2b6940a02978cf47bc62e15e1233dbdf': 'StageScheduleQuery',
    '730cd98eede484824caa36ab788d7155': 'StageScheduleQuery',
    'd1f062c14f74f758616fe25ad7107030': 'StageScheduleQuery',
    '90757d5cb46cb8e0cc1ebc0a66d0ef06': 'StageScheduleQuery',
    '44ec3cbe665e7be6866bf04f86d88c00': 'StageScheduleQuery',

    // Home
    '7c2a71bf679e0a6d59b2072e27ff8a38': 'HomeQuery',
    '2d09459f13b7dc2a7a40d5e1cc1533bb': 'HomeQuery',
    '6eb11342ee8ab72d0016a9a7a92ca8a2': 'HomeQuery',
    'a69c0d38c11574a6b1e5fe8e50b86a87': 'HomeQuery',

    // Battle Histories
    '80585ad4e4ecb674c3d8cd278adb1d21': 'LatestBattleHistoriesQuery',
    '0329c535a32f305650037a3f1d48c951': 'LatestBattleHistoriesQuery',
    '7b494639be58721ad3fa12c98d633391': 'LatestBattleHistoriesQuery',
    'e776a0204128f1146312480eb9a00a12': 'LatestBattleHistoriesQuery',
    '9863ea4744737a4e69b0a7970b55a004': 'BankaraBattleHistoriesQuery',
    '441968853b05f2b800539c368d4d7a8d': 'BankaraBattleHistoriesQuery',
    '430635e917d092ffc9be2246ad5e7a9c': 'RegularBattleHistoriesQuery',
    'd83d95eb05f42c2c0692d77cb30cb9cf': 'RegularBattleHistoriesQuery',
    'b7296062f6b864a7802875b8a05c9a4a': 'XBattleHistoriesQuery',
    '4b736b4a5301ffb0fae00508ffb8f725': 'XBattleHistoriesQuery',
    '291295ad311d9943345744d9537ad4e4': 'VsHistoryDetailQuery',
    'cdae6eab6d2a05cf504ab764f697475f': 'VsHistoryDetailQuery',
    '994e9ade5477c7569b91e9882255be2f': 'VsHistoryDetailQuery',

    // Salmon Run / Coop
    'e11a8cf28f4153a0ff99863d08fcf5e2': 'CoopHistoryQuery',
    '817618ce39bcf3670b587a2f73b29346': 'CoopHistoryQuery',
    '91b917cca2fb69383dd1251a03b6e578': 'CoopHistoryQuery',
    'a2c077e36603a11b6d1945fe6ee8233f': 'CoopHistoryQuery',
    'f3799a033f0a7ad4b0b39e7c49129bf0': 'CoopHistoryDetailQuery',
    '9d727274718281fdb09b5f6f23814b60': 'CoopHistoryDetailQuery',

    // Gear / Gesotown / Catalog / Shop
    'a75d56b4f73ba9ea6b567d1ab808269d': 'GesotownQuery',
    'a43dd44899a09013bcfd29b4f1713143': 'GesotownQuery',
    '731eb93a86fc0e514f77c8e27c1cb322': 'GesotownQuery',
    '5c98d60d3c0b050f28a9b34389fb13b1': 'CatalogQuery',
    'a43dd44899a09013bcfd29b4f1713144': 'CatalogQuery',

    // Friends / Profile / Outfits / Badges
    '8e89459f13b7dc2a7a40d5e1cc1533bb': 'FriendListQuery',
    '7a88b185b987fa4d536d59b223373e63': 'FriendListQuery',
    '4a20b185b987fa4d536d59b223373e64': 'FriendListQuery',
    '581297e68222dc666324b12759e66cb4': 'FriendListQuery',
    'd83d95eb05f42c2c0692d77cb30cb9ce': 'MyOutfitDetailQuery',
    '04a0d63d0490b4d45d3e0ab27d3b5b5c': 'HistoryRecordQuery',
    '91cfab66b60e4b7899be6eb049da418e': 'HistoryRecordQuery',

    // Fest / Events / Replays / Challenges
    '538f516f861b802c19f84940d7f48e35': 'CurrentFestQuery',
    '7487784409341416e7054a1d48c8b211': 'FestRecordQuery',
    '2b1b369d4948a9754f9a0c1032e65095': 'ReplayListQuery',
    'b48ec42da65022634e7f86eb8c7a6e12': 'ChallengeJourneyQuery'
};

export function lookupSplatNet3OperationName(hash: string): string {
    if (!hash || typeof hash !== 'string') return 'unknown';
    const cleanHash = hash.toLowerCase().trim();
    if (SPLATNET3_QUERY_NAMES[cleanHash]) {
        return SPLATNET3_QUERY_NAMES[cleanHash];
    }
    for (const [knownHash, name] of Object.entries(SPLATNET3_QUERY_NAMES)) {
        if (knownHash.startsWith(cleanHash) || cleanHash.startsWith(knownHash.slice(0, 8))) {
            return name;
        }
    }
    return 'unknown';
}
