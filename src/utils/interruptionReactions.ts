export const DEFAULT_INTERRUPTION_REACTION =
  "C'est malpoli, ça ! J'ai pas fini… Mais vas-y, je t'en prie, je t'écoute, toi qui as tellement envie de parler ! 🤣";

export const VARIED_INTERRUPTION_REACTIONS: string[] = [
  "Oh, pardon ! Mes arguments te dérangeaient ? Vas-y, coupe-moi la parole, je prends des notes… 🤣",
  "Ah, on m'interrompt en plein élan ! D'accord, chef, le micro est à toi. 😉",
  "Eh oh, un peu de tenue ! Même une IA mérite de finir sa phrase… Allez, parle, je t'écoute. 😏",
  "Visiblement, ce que tu as à dire ne peut pas attendre deux secondes ! Je me tais, balance ton idée. 🤣",
  "Touché ou pressé ? Va savoir… Je coupe le son, à toi l'antenne ! 😄",
  "Tu me coupes le sifflet comme ça ? Audacieux. Vas-y, surprends-moi ! 😏",
];

export function stripEmojisForSpeech(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
