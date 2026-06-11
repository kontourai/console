# Record with: vhs scripts/golden-demo.tape   (hub must be running)
Output docs/assets/golden-demo.gif
Set Shell "bash"
Set FontSize 14
Set Width 1080
Set Height 720
Set Padding 20
Set PlaybackSpeed 1.5
Set Theme { "background": "#0a0e13", "foreground": "#eef3f8", "black": "#16202d", "red": "#ff6f6f", "green": "#34d399", "yellow": "#f3b14b", "blue": "#7aa2ff", "magenta": "#5cc4e0", "cyan": "#5ce0c6", "white": "#eef3f8", "brightBlack": "#72869b", "brightRed": "#ff6f6f", "brightGreen": "#34d399", "brightYellow": "#f3b14b", "brightBlue": "#7aa2ff", "brightMagenta": "#5cc4e0", "brightCyan": "#5ce0c6", "brightWhite": "#ffffff", "cursor": "#5ce0c6" }
Set TypingSpeed 30ms

Type "node --import tsx scripts/golden-demo.ts"
Sleep 500ms
Enter
Sleep 95s
