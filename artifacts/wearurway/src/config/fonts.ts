// ─── Custom Font Configuration ────────────────────────────────────────────────
//
// Font files live in:  artifacts/wearurway/public/fonts/
//
// To ADD a font:
//   1. Drop the .woff2 file into the public/fonts/ folder.
//   2. Add a new entry to the CUSTOM_FONTS array below.
//
// To REMOVE a font:
//   1. Delete its entry from CUSTOM_FONTS below (the file can stay or be deleted).
//
// ──────────────────────────────────────────────────────────────────────────────

export interface FontConfig {
  name: string;      // Label shown in the UI
  family: string;    // CSS font-family name (must be unique — used as FontFace id)
  filename: string;  // Filename inside public/fonts/   e.g.  "MyFont.woff2"
}

export const CUSTOM_FONTS: FontConfig[] = [
  { name: "Angry Portrait",  family: "AngryPortraitToumpano", filename: "AngryPortraitToumpano.woff2" },
  { name: "Badeen Display",  family: "BadeenDisplay",         filename: "BadeenDisplay.woff2"         },
  { name: "Ballet",          family: "Ballet",                filename: "Ballet.woff2"                },
  { name: "Bowlby One SC",   family: "BowlbyOneSC",           filename: "BowlbyOneSC.woff2"           },
  { name: "Bulbasaur SP",    family: "BulbasaurSP",           filename: "BulbasaurSP.woff2"           },
  { name: "Devina Garden",   family: "DevinaGarden",          filename: "DevinaGarden.woff2"          },
  { name: "Hypik",           family: "Hypik",                 filename: "Hypik.woff2"                 },
  { name: "Knewave",         family: "Knewave",               filename: "Knewave.woff2"               },
  { name: "Modak",           family: "Modak",                 filename: "Modak.woff2"                 },
  { name: "Moderniz",        family: "Moderniz",              filename: "Moderniz.woff2"              },
  { name: "Playlist Script", family: "PlaylistScript",        filename: "PlaylistScript.woff2"        },
  { name: "Super Basic",     family: "SuperBasic",            filename: "SuperBasic.woff2"            },
  { name: "Veter",           family: "Veter",                 filename: "Veter.woff2"                 },
];
