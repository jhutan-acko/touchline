"""Phrase tables shared by the Narrator, the Personalizer and the Recap Producer: headlines per moment type, metric
labels and club framing, in English, Spanish and Hindi (written natively, not machine-translated)."""

NEGATIVE = {"costly_error", "card"}  # bad news for the moment's own team

HEADLINES: dict[str, dict[str, str]] = {
    "en": {"goal": "Goal for {team}!", "costly_error": "Costly error by {player}", "big_chance": "Big chance for {team}", "press_up": "{team} turn up the pressure",
           "press_down": "{team} ease off the press", "momentum_swing": "Momentum swings to {team}", "chaos_spike": "End-to-end football",
           "red": "Red card for {player}", "yellow": "Booking for {player}", "speed_alert": "{player} at full speed", "distance_milestone": "{player} keeps running",
           "player_milestone": "Milestone for {player}", "difficult_pass_completed": "Superb pass from {player}", "substitution_impact": "{team}'s changes make an impact"},
    "es": {"goal": "¡Gol de {team}!", "costly_error": "Error costoso de {player}", "big_chance": "Gran ocasión para {team}", "press_up": "{team} aprieta en la presión",
           "press_down": "{team} afloja la presión", "momentum_swing": "El impulso es de {team}", "chaos_spike": "Partido de ida y vuelta",
           "red": "Roja para {player}", "yellow": "Amarilla para {player}", "speed_alert": "{player}, a toda velocidad", "distance_milestone": "{player} no para de correr",
           "player_milestone": "Hito para {player}", "difficult_pass_completed": "Pase magnífico de {player}", "substitution_impact": "Los cambios de {team} surten efecto"},
    "hi": {"goal": "{team} का गोल!", "costly_error": "{player} की महंगी गलती", "big_chance": "{team} के लिए बड़ा मौका", "press_up": "{team} ने दबाव बढ़ाया",
           "press_down": "{team} ने दबाव घटाया", "momentum_swing": "लय {team} के पक्ष में", "chaos_spike": "आमने-सामने का खेल",
           "red": "{player} को लाल कार्ड", "yellow": "{player} को पीला कार्ड", "speed_alert": "{player} पूरी रफ़्तार में", "distance_milestone": "{player} लगातार दौड़ रहे हैं",
           "player_milestone": "{player} की उपलब्धि", "difficult_pass_completed": "{player} का शानदार पास", "substitution_impact": "{team} के बदलावों का असर"},
}
LABELS: dict[str, dict[str, str]] = {
    "en": {"shot.xg": "Expected goals for the chance", "team.press": "Pressure index", "ppda": "Opponent passes per defensive action", "tilt": "Field tilt",
           "team.mom": "Momentum share", "game.chaos": "Control-versus-chaos index", "plyr.vmax": "Top speed in km/h", "plyr.dist": "Metres covered",
           "pass.xp": "Completion probability of the pass", "pass.acc": "Pass accuracy", "team.poss": "Possession", "act.xt": "Expected threat added",
           "pitch.ctrl": "Pitch control", "pass.dist": "Average pass length in metres", "shot.speed": "Shot speed in km/h", "ball.speed": "Ball speed in km/h", "score": "Score"},
    "es": {"shot.xg": "Goles esperados de la ocasión", "team.press": "Índice de presión", "ppda": "Pases rivales por acción defensiva", "tilt": "Inclinación del campo",
           "team.mom": "Cuota de impulso", "game.chaos": "Índice de control frente a caos", "plyr.vmax": "Velocidad máxima en km/h", "plyr.dist": "Metros recorridos",
           "pass.xp": "Probabilidad de completar el pase", "pass.acc": "Precisión de pase", "team.poss": "Posesión", "act.xt": "Amenaza esperada añadida",
           "pitch.ctrl": "Control del campo", "pass.dist": "Longitud media de pase en metros", "shot.speed": "Velocidad del disparo en km/h", "ball.speed": "Velocidad del balón en km/h", "score": "Marcador"},
    "hi": {"shot.xg": "मौके का अपेक्षित गोल (xG)", "team.press": "दबाव सूचकांक", "ppda": "प्रति रक्षात्मक कार्रवाई विरोधी पास", "tilt": "मैदान का झुकाव",
           "team.mom": "लय में हिस्सेदारी", "game.chaos": "नियंत्रण बनाम अराजकता सूचकांक", "plyr.vmax": "शीर्ष गति (किमी/घंटा)", "plyr.dist": "तय की गई दूरी (मीटर)",
           "pass.xp": "पास पूरा होने की संभावना", "pass.acc": "पास सटीकता", "team.poss": "कब्ज़ा", "act.xt": "जोड़ा गया अपेक्षित ख़तरा",
           "pitch.ctrl": "मैदान पर नियंत्रण", "pass.dist": "औसत पास लंबाई (मीटर)", "shot.speed": "शॉट की गति (किमी/घंटा)", "ball.speed": "गेंद की गति (किमी/घंटा)", "score": "स्कोर"},
}
FRAMING: dict[str, tuple[str, str]] = {
    "en": ("Good news for {club}.", "Bad news for {club}."),
    "es": ("Buenas noticias para {club}.", "Malas noticias para {club}."),
    "hi": ("{club} के लिए अच्छी खबर।", "{club} के लिए बुरी खबर।"),
}


def headline_key(moment: dict, cause: str) -> str:
    t = moment["type"]
    if t == "pressure_shift":
        return "press_down" if cause == "press dropping off" else "press_up"
    if t == "card":
        return "red" if cause == "red card" else "yellow"
    return t


def headline(moment: dict, cause: str, names: dict[str, str], lang: str = "en") -> str:
    """The template headline for a moment, naming its team or player."""
    team = names.get(moment["team_id"] or "", "")
    player = names.get(moment["player_id"] or "", team)
    return HEADLINES[lang][headline_key(moment, cause)].format(team=team, player=player)
