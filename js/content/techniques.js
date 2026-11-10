// Dreaming's own lucid-dreaming guides, one per TECHNIQUES id in js/progress.js.
// Plain data plus a small line-art glyph per technique. No DOM or storage access.

const g = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const GLYPHS = {
  'reality-checks': g('<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v6"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-.8a7 7 0 0 1-5.5-2.7L3.8 15.6a1.6 1.6 0 0 1 2.4-2.1L8 15.3"/>'),
  wild: g('<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M3.5 21h17"/><circle cx="14.6" cy="12.5" r="0.9"/><path d="M10 7.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L8 9.5l1.4-.6z"/>'),
  'audio-cues': g('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6.5" rx="1.6"/><rect x="17" y="14" width="4" height="6.5" rx="1.6"/>'),
  mild: g('<path d="M5 18.5l-1.5 3 3.6-1.6A8.5 7.5 0 1 0 5 18.5z"/><path d="M12 7.5l1 2.3 2.4.3-1.8 1.6.5 2.4L12 13l-2.1 1.1.5-2.4-1.8-1.6 2.4-.3z"/>'),
  wbtb: g('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4.2l2.6 1.8"/><path d="M3.8 5.2 6.6 3M20.2 5.2 17.4 3"/>'),
  ssild: g('<circle cx="12" cy="5" r="2.2"/><circle cx="5.5" cy="17.5" r="2.2"/><circle cx="18.5" cy="17.5" r="2.2"/><path d="M10.7 7.1 7 15.3M13.3 7.1 17 15.3M8 17.5h8"/>'),
  finger: g('<path d="M9 22v-6.2L7.1 13.3a1.5 1.5 0 0 1 2.3-1.9L11 13V5a1.5 1.5 0 0 1 3 0v6.2l3.4.8a2 2 0 0 1 1.5 2.2L18.2 22"/><path d="M6.5 6.5c.9-.9.9-2.3 0-3.2M17.5 6.5c.9-.9.9-2.3 0-3.2"/>'),
  anchor: g('<circle cx="12" cy="4.8" r="2"/><path d="M12 6.8V21"/><path d="M4.5 13.5a7.5 7.5 0 0 0 15 0"/><path d="M8.5 10h7"/>'),
  counting: g('<path d="M6 5v14M10 5v14M14 5v14M18 5v14"/><path d="M3.5 16.5l17-9"/>'),
  conditioning: g('<path d="M6.5 16v-4.8a5.5 5.5 0 0 1 11 0V16l1.5 2h-14z"/><path d="M10.2 20.2a2 2 0 0 0 3.6 0"/><path d="M2.8 10a9 9 0 0 1 2-5M21.2 10a9 9 0 0 0-2-5"/>'),
};

/** Small line-art glyph for a technique (SVG string). */
export function techniqueGlyph(id) {
  return GLYPHS[id] || GLYPHS['reality-checks'];
}

export const SECTION_LABELS = {
  techniques: 'Techniques',
  'falling-asleep': 'While falling asleep',
  'night-training': 'Night training',
};

/**
 * Guide content keyed by technique id.
 * { tagline, when (short), level, hue, what[], whenText, steps[], tips[], mistakes[], pairsWith[], articles[] }
 */
export const TECHNIQUE_CONTENT = {
  'reality-checks': {
    tagline: 'Ask "am I dreaming?" by day, so you ask it in dreams too.',
    when: 'During the day',
    level: 'Beginner',
    hue: 268,
    what: [
      'A reality check is a quick test of whether you are awake or dreaming. In waking life the answer is boring and always the same. In a dream, the test often fails in an obvious way: text changes when you look twice, a clock shows nonsense, you can breathe through a pinched nose.',
      'The point is the habit. Whatever you do often during the day tends to show up in your dreams. If questioning reality becomes routine, sooner or later you will do it inside a dream, the test will fail, and you will realise you are dreaming.',
    ],
    whenText: 'Throughout the day, around 10 to 15 times. The best moments are the ones that feel a little odd or dreamlike, and moments that match your personal dream signs (things that keep showing up in your journal).',
    steps: [
      'Pick two checks you like. One should be very reliable, such as the nose pinch or reading text twice.',
      'Stop for a moment and ask yourself, seriously: "Am I dreaming right now?"',
      'Do the first check, really expecting that it might work. Then do the second one.',
      'Look around and think back: how did I get here? What was I doing five minutes ago? Dreams rarely have a clear before.',
      'Finish by imagining what you would do if this had been a dream, for example flying or trying one of your dream goals.',
    ],
    tips: [
      'Tie checks to triggers you meet often: walking through a doorway, unlocking your phone, drinking water, hearing your name.',
      'Read your journal for dream signs (an old school, a certain person, being late) and do a check whenever one turns up in real life.',
      'Always use at least two checks. One check can fail even in a dream, especially looking at your hands.',
      'Calendar reminders help at the start. After a few weeks the habit usually runs on its own.',
    ],
    mistakes: [
      'Doing it on autopilot. A check without real curiosity is the kind that never carries into dreams.',
      'Deciding you are awake before the test is done.',
      'Stopping after a week. It often takes a few weeks of steady practice before the first lucid dream.',
    ],
    checks: [
      { name: 'Nose pinch', how: 'Pinch your nose shut and try to breathe through it.', dream: 'In a dream, air often flows anyway.' },
      { name: 'Read twice', how: 'Read a line of text, look away, read it again.', dream: 'In a dream, words often change or blur.' },
      { name: 'Clock check', how: 'Look at a digital clock, look away, look back.', dream: 'In a dream, the time jumps or makes no sense.' },
      { name: 'Hands', how: 'Look closely at your hands and count your fingers.', dream: 'In a dream, fingers may be extra, missing or strange.' },
      { name: 'Finger through palm', how: 'Push a finger gently against your other palm, expecting it to go through.', dream: 'In a dream, it may slide right in.' },
      { name: 'Memory', how: 'Try to recall how you got here and what you did before.', dream: 'In a dream, there is often no clear answer.' },
    ],
    pairsWith: ['mild', 'anchor'],
    articles: ['reality-checks', 'dream-signs', 'lucid-basics'],
  },

  wild: {
    tagline: 'Fall asleep while staying aware, and step straight into a dream.',
    when: 'Falling asleep',
    level: 'Advanced',
    hue: 290,
    what: [
      'WILD stands for wake-initiated lucid dream. Instead of becoming lucid inside a dream, you carry your awareness with you from waking into sleep. Your body falls asleep, your mind stays gently awake, and a dream scene forms around you.',
      'It is the most direct method, and also the one that takes most practice. Most people succeed with it in the early morning, when the brain moves into dreaming sleep (REM) quickly.',
    ],
    whenText: 'After about 4.5 to 6 hours of sleep, ideally combined with Wake back to bed. At the very start of the night it rarely works, because the first hours are mostly deep, dreamless sleep.',
    steps: [
      'Wake up after 4.5 to 6 hours of sleep and stay up for a few minutes (see Wake back to bed).',
      'Lie down in a position you can stay in without moving. Many people use their back; any position works.',
      'Relax your body from feet to head. Let your breathing slow down on its own.',
      'Keep a light focus: your breath, a slow count, or the shapes and colours behind your eyelids.',
      'Watch whatever appears as you drift: patterns, flashes of images, sounds, voices. Observe them without grabbing at them.',
      'You may feel heaviness, tingling, buzzing or the sense that you cannot move. This is your body falling asleep. Stay calm and keep observing.',
      'When a scene becomes clear and solid, step into it gently. Do a reality check right away to confirm you are dreaming.',
    ],
    tips: [
      'Think "relaxed curiosity", not effort. Trying hard keeps you awake.',
      'If you notice you have been lying awake for 20 to 30 minutes, let go and simply sleep. Try again another morning.',
      'The strange body sensations can feel intense, but they are a normal part of falling asleep. If you want them to stop, wiggle a finger or toe and you will wake up fully.',
      'A theta binaural beat at low volume can be a pleasant background while you practise.',
    ],
    mistakes: [
      'Trying it at bedtime as a beginner, then lying awake for an hour.',
      'Checking every few seconds whether "it is working yet".',
      'Moving, scratching or swallowing on purpose when the sensations start. Small movements reset the process.',
      'Panicking at the sensations. Calm observation is what carries you through.',
    ],
    pairsWith: ['wbtb', 'counting'],
    articles: ['sleep-paralysis', 'lucid-basics'],
  },

  'audio-cues': {
    tagline: 'Let a familiar sound slip into your dream and remind you.',
    when: 'In the night',
    level: 'Intermediate',
    hue: 200,
    what: [
      'Sounds from the outside world often leak into dreams: an alarm becomes a ringing phone, rain becomes a waterfall. Audio cues use this on purpose. You choose one distinctive sound, link it to the thought "I might be dreaming", and then let it play quietly during late-night sleep.',
      'When the cue shows up in a dream, it can trigger the same question it triggers by day. Sleep researchers have used this idea (sometimes called targeted lucidity reactivation) in lab studies.',
    ],
    whenText: 'In the second half of the night or during a morning nap, when dreaming sleep is longest. Before that, link the sound to awareness during the day.',
    steps: [
      'Choose one soft, distinctive sound. You can use the Dreaming cue below.',
      'Link it to awareness: whenever you hear it during the day, do a full reality check.',
      'At bedtime, play the cue a few times while you set the intention: "When I hear this sound, I will know I am dreaming."',
      'Arrange for it to play quietly later in the night, for example 5 to 7 hours after you fall asleep, using a gentle low-volume alarm or a timer on a second device.',
      'If you notice the sound in a dream, do a reality check and stay calm.',
    ],
    tips: [
      'The cue should be quiet enough not to wake you. If it wakes you, lower the volume next time.',
      'Use the same sound every time. A new sound has no meaning to your brain yet.',
      'Pairs well with Wake back to bed: play the cue softly while you drift back to sleep.',
    ],
    mistakes: [
      'Playing the cue too loud, so it simply wakes you up.',
      'Playing it early in the night, during deep sleep.',
      'Skipping the daytime practice, so the sound means nothing in the dream.',
    ],
    honest: 'A home-screen web app cannot play sound at a set time while your phone is locked. Use a gentle alarm or a second device for the night-time part, and the button below to hear and practise with the cue.',
    pairsWith: ['wbtb', 'conditioning'],
    articles: ['lucid-basics'],
  },

  mild: {
    tagline: 'Set a clear intention to notice the next dream.',
    when: 'Falling asleep',
    level: 'Beginner',
    hue: 320,
    what: [
      'MILD means mnemonic induction of lucid dreams. It trains a kind of memory you use every day: remembering to do something in the future. Here, the thing to remember is "notice that I am dreaming".',
      'You rehearse the moment of becoming lucid in a dream you just had, then fall asleep holding that intention. It is one of the most studied techniques, and it works especially well together with Wake back to bed.',
    ],
    whenText: 'When you wake up from a dream in the night or early morning, and as you go back to sleep. It works best after 4.5 to 6 hours of sleep.',
    steps: [
      'When you wake from a dream, lie still and recall it in as much detail as you can. Jot down the key points if that helps.',
      'Find a moment in that dream where something was odd: a dream sign you could have noticed.',
      'As you settle back to sleep, tell yourself with real meaning: "Next time I am dreaming, I will remember that I am dreaming."',
      'Picture yourself back in that dream. See the odd moment, realise "this is a dream", and imagine what you do next.',
      'Repeat the phrase and the picture until the intention feels firmly set, then let go and fall asleep.',
    ],
    tips: [
      'Meaning matters more than repetition. Ten sincere seconds beat ten minutes of mumbling.',
      'If you cannot remember a dream, use a recent one from your journal or invent one.',
      'Try to fall asleep within a few minutes of setting the intention.',
    ],
    mistakes: [
      'Repeating the phrase mechanically while thinking about something else.',
      'Staying awake too long, so you end up wide awake instead of sleepy.',
      'Rehearsing so hard that you cannot relax into sleep.',
    ],
    pairsWith: ['wbtb', 'reality-checks'],
    articles: ['dream-signs', 'dream-recall'],
  },

  wbtb: {
    tagline: 'Wake briefly in the night, then go back to sleep into longer dreams.',
    when: 'In the night',
    level: 'Beginner',
    hue: 40,
    what: [
      'Dreaming sleep (REM) comes in cycles about every 90 minutes, and the periods get longer toward the morning. Wake back to bed uses this: you wake up after several hours, stay awake briefly, then fall asleep again straight into the most dream-rich part of the night.',
      'On its own it raises your chances of a vivid, memorable dream. Combined with MILD, WILD, SSILD or FILD it is one of the most reliable ways to become lucid.',
    ],
    whenText: 'On a night when you can sleep in or spare a little sleep, about 4.5 to 6 hours after you fall asleep.',
    steps: [
      'Set an alarm for 4.5 to 6 hours after you expect to fall asleep. The calculator below helps.',
      'When it rings, get up. Keep the lights dim.',
      'Stay awake for 10 to 30 minutes: write down any dreams, read about lucid dreaming, look over your dream goals.',
      'Go back to bed with one technique in mind, such as MILD or SSILD.',
      'Fall asleep holding a light intention to notice your next dream.',
    ],
    tips: [
      'Light sleepers may only need a few minutes awake. Heavy sleepers may need 20 to 30.',
      'Avoid bright screens and caffeine while you are up.',
      'Use it on weekends or free mornings, not before a day when you need full rest.',
    ],
    mistakes: [
      'Staying up so long that you cannot fall asleep again.',
      'Scrolling your phone in full brightness while awake.',
      'Using it every night until you are short on sleep.',
    ],
    pairsWith: ['mild', 'wild', 'ssild', 'finger'],
    articles: ['sleep-hygiene', 'lucid-basics'],
  },

  ssild: {
    tagline: 'Cycle gently through sight, sound and touch as you drift off.',
    when: 'Falling asleep',
    level: 'Beginner',
    hue: 180,
    what: [
      'SSILD stands for senses-initiated lucid dream. You calmly turn your attention through three senses (what you see behind your closed eyes, what you hear, and what you feel in your body) in a few short and a few long cycles, then go to sleep.',
      'It is relaxed and forgiving: you do not need to stay awake or "see" anything special. Many people find that it leads to lucid dreams or to waking up and noticing a false awakening.',
    ],
    whenText: 'After 4.5 to 6 hours of sleep, together with Wake back to bed.',
    steps: [
      'After waking in the night, stay up for about 5 minutes, then lie down comfortably.',
      'Sight: with eyes closed, look at the darkness behind your eyelids for a few seconds. Do not try to see anything.',
      'Sound: turn your attention to sounds around you, or to the silence, for a few seconds.',
      'Touch: notice your body, its weight, temperature or any small sensations, for a few seconds.',
      'Do four to six of these quick cycles, then three or four slow cycles, about 30 seconds on each sense.',
      'Then stop, turn to your favourite sleeping position and fall asleep without trying to stay aware.',
      'If you wake later, stay still for a moment and do a reality check: you may still be dreaming.',
    ],
    tips: [
      'Keep it effortless. Losing count or dozing off mid-cycle is fine.',
      'False awakenings (dreaming that you woke up) are common after SSILD. Always check on waking.',
      'If it never seems to work, try a shorter wake period before you start.',
    ],
    mistakes: [
      'Straining to see lights or hear sounds.',
      'Trying to stay awake after the cycles. The method relies on you falling asleep.',
      'Skipping the check after waking up.',
    ],
    pairsWith: ['wbtb'],
    articles: ['lucid-basics'],
  },

  finger: {
    tagline: 'Tiny finger movements carry you into sleep with awareness.',
    when: 'Falling asleep',
    level: 'Intermediate',
    hue: 240,
    what: [
      'FILD stands for finger-induced lucid dream. When you are extremely sleepy after waking in the night, you make tiny alternating movements with two fingers, as if pressing piano keys. The small task keeps a sliver of awareness alive while the rest of you slips back into sleep.',
      'After 20 to 30 seconds you do a reality check. If you are already dreaming, the check fails and you are lucid.',
    ],
    whenText: 'When you wake naturally or by a quiet alarm after 5 to 6 hours of sleep, while you are still very drowsy. Unlike WBTB, you stay in bed and barely wake up.',
    steps: [
      'Wake briefly in the late night or early morning. Do not get up and do not open your eyes much.',
      'Lie comfortably and gently press your index and middle finger down in turn, as if playing two piano keys.',
      'Keep the movement minimal, almost imagined. You should barely feel it.',
      'After 20 to 30 seconds, do a nose-pinch check: try to breathe through your pinched nose.',
      'If you can breathe, you are dreaming. If not, go back to sleep and try again at your next awakening.',
    ],
    tips: [
      'It only works when you are very sleepy. If you feel alert, just go back to sleep.',
      'A quiet alarm set 5 to 6 hours in can create the right moment.',
      'Do not repeat it for minutes on end. Short attempts work best.',
    ],
    mistakes: [
      'Waking up too much before trying.',
      'Moving the fingers visibly instead of just barely.',
      'Forgetting the reality check at the end.',
    ],
    pairsWith: ['wbtb'],
    articles: ['lucid-basics'],
  },

  anchor: {
    tagline: 'Link lucidity to a personal anchor you see every day.',
    when: 'Day and in the dream',
    level: 'Intermediate',
    hue: 30,
    what: [
      'An anchor is one small, personal thing you link to the question "am I dreaming?". It could be a ring or bracelet you wear, a letter drawn on your hand, or a phrase you say. Every time you notice it during the day, you do a reality check.',
      'Because you see your anchor so often, it tends to appear in dreams too, often slightly wrong: the ring is missing, the mark has changed. That small mismatch is your cue. Once lucid, your anchor also helps you stay calm and keep the dream steady.',
    ],
    whenText: 'All day as a habit, and inside the dream as a way to steady yourself once you are lucid.',
    steps: [
      'Choose your anchor: something you will notice many times a day, such as a ring, watch, bracelet or a small mark on your hand.',
      'Each time you notice it, pause, do a reality check and ask how you got here.',
      'At bedtime, look at your anchor and set the intention: "When I see this in a dream, I will know I am dreaming."',
      'In a dream, check your anchor. If it looks odd or is missing, do a reality check.',
      'Once lucid and the dream starts to fade, look at your anchor or rub your hands together and focus on the feeling. This often makes the dream clearer.',
    ],
    tips: [
      'Keep the same anchor for weeks. The link grows stronger with repetition.',
      'If you stop noticing it, change where you wear it.',
      'Combine with Reality checks: the anchor is simply a reliable trigger for them.',
    ],
    mistakes: [
      'Picking something you rarely look at.',
      'Glancing at the anchor without actually doing a check.',
      'Switching anchors every few days.',
    ],
    pairsWith: ['reality-checks'],
    articles: ['stay-lucid', 'reality-checks'],
  },

  counting: {
    tagline: 'Count slowly to keep a thread of awareness into sleep.',
    when: 'Falling asleep',
    level: 'Intermediate',
    hue: 210,
    what: [
      'Counting is a simple way to stay aware as you fall asleep, a gentler entry into WILD. The count gives your mind a light task, so you notice the moment you start drifting instead of losing awareness completely.',
      'A popular version adds the reminder to each number: "one, I am dreaming; two, I am dreaming…". When the count gets fuzzy and images start to appear, you are close to the dream.',
    ],
    whenText: 'After 4.5 to 6 hours of sleep, together with Wake back to bed, or during an afternoon nap.',
    steps: [
      'Lie down comfortably and relax your body.',
      'Count slowly, about one number per breath. Optionally add "I am dreaming" after each number.',
      'Let the count become lighter and slower as you relax.',
      'When you notice you lost count, or images and sounds start to appear, keep a light awareness: "I am falling asleep now."',
      'When a dream scene forms, step into it and do a reality check.',
    ],
    tips: [
      'Do not force it. If you lose count, just start again from one without frustration.',
      'Losing count and then noticing it is a good sign: you are on the edge of sleep.',
      'A low-volume theta binaural beat or brown noise can make the background quieter.',
    ],
    mistakes: [
      'Counting fast, as if it were a race.',
      'Getting annoyed at losing count, which wakes you up.',
      'Trying it at the very start of the night as a beginner.',
    ],
    pairsWith: ['wild', 'wbtb'],
    articles: ['lucid-basics', 'sleep-paralysis'],
  },

  conditioning: {
    tagline: 'Train a sound to mean "you are dreaming".',
    when: 'Day, then night',
    level: 'Advanced',
    hue: 160,
    what: [
      'Sound conditioning is the structured, longer version of Audio cues. Over days or weeks you pair one cue sound with a full moment of awareness, many times, until hearing the sound automatically makes you ask "am I dreaming?".',
      'A well-trained cue is much more likely to work when it later reaches you in a dream. The practice session below plays the cue at random moments while the screen is open; each time you hear it, you do a reality check.',
    ],
    whenText: 'Practise during the day, a few sessions a week. Then use the cue at night as described in Audio cues.',
    steps: [
      'Start a practice session below and put the phone down nearby. Keep this screen open.',
      'Go about your activity. The cue plays at random intervals.',
      'Each time you hear it, stop, do two reality checks, look around and ask how you got here.',
      'Practise like this for 15 to 30 minutes, a few times a week.',
      'After a week or two, start playing the cue softly in the late night or during a morning nap, using a gentle alarm or a second device.',
    ],
    tips: [
      'Respond to every cue. Ignoring it teaches your brain that the sound means nothing.',
      'Use the same cue for training and at night.',
      'Keep night-time volume very low so it reaches the dream without waking you.',
    ],
    mistakes: [
      'Training only once or twice, then expecting it to work.',
      'Responding half-heartedly, without a real check.',
      'Playing the cue so loud at night that it wakes you.',
    ],
    honest: 'The cue only plays while Dreaming is open on screen. Your phone stops web sounds when it locks.',
    pairsWith: ['audio-cues', 'reality-checks'],
    articles: ['reality-checks'],
  },
};

export function getTechniqueContent(id) {
  return TECHNIQUE_CONTENT[id] || null;
}
