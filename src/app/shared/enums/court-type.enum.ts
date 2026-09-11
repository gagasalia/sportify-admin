import { liveLabels } from '../i18n/lang';

export enum SportType {
  Padel = 'padel',
}

/** Labels stay RAW Georgian; `liveLabels` translates on every read. */
export const SPORT_TYPE_LABELS: Record<SportType, string> = liveLabels({
  [SportType.Padel]: 'პადელი',
});

export const SPORT_TYPE_ICONS: Record<SportType, string> = {
  [SportType.Padel]: '@lucide.racket',
};

export enum CourtLocationType {
  Indoor = 'indoor',
  Outdoor = 'outdoor',
  Covered = 'covered',
}

export const COURT_LOCATION_TYPE_LABELS: Record<CourtLocationType, string> = liveLabels({
  [CourtLocationType.Indoor]: 'შენობაში',
  [CourtLocationType.Outdoor]: 'ღია ცის ქვეშ',
  [CourtLocationType.Covered]: 'გადახურული',
});

export enum SurfaceMaterial {
  Clay = 'clay',
  Grass = 'grass',
  Concrete = 'concrete',
  Synthetic = 'synthetic',
  Hardcourt = 'hardcourt',
}

export const SURFACE_MATERIAL_LABELS: Record<SurfaceMaterial, string> = liveLabels({
  [SurfaceMaterial.Clay]: 'თიხა',
  [SurfaceMaterial.Grass]: 'ბალახი',
  [SurfaceMaterial.Concrete]: 'ბეტონი',
  [SurfaceMaterial.Synthetic]: 'სინთეტიკური',
  [SurfaceMaterial.Hardcourt]: 'მყარი საფარი',
});

export enum SurfaceColor {
  Blue = 'blue',
  Green = 'green',
  Red = 'red',
  Orange = 'orange',
  Gray = 'gray',
  Brown = 'brown',
}

export const SURFACE_COLOR_LABELS: Record<SurfaceColor, string> = liveLabels({
  [SurfaceColor.Blue]: 'ლურჯი',
  [SurfaceColor.Green]: 'მწვანე',
  [SurfaceColor.Red]: 'წითელი',
  [SurfaceColor.Orange]: 'ნარინჯისფერი',
  [SurfaceColor.Gray]: 'ნაცრისფერი',
  [SurfaceColor.Brown]: 'ყავისფერი',
});

// Legacy exports for backwards compatibility
export enum CourtType {
  Tennis = 'tennis',
  Padel = 'padel',
  Basketball = 'basketball',
  Football = 'football',
  Volleyball = 'volleyball',
}

export const COURT_TYPE_LABELS: Record<CourtType, string> = liveLabels({
  [CourtType.Tennis]: 'ჩოგბურთის კორტი',
  [CourtType.Padel]: 'პადელის კორტი',
  [CourtType.Basketball]: 'კალათბურთის კორტი',
  [CourtType.Football]: 'ფეხბურთის მოედანი',
  [CourtType.Volleyball]: 'ფრენბურთის კორტი',
});

export const COURT_TYPE_ICONS: Record<CourtType, string> = {
  [CourtType.Tennis]: '@lucide.tennis-ball',
  [CourtType.Padel]: '@lucide.racket',
  [CourtType.Basketball]: '@lucide.basketball',
  [CourtType.Football]: '@lucide.football',
  [CourtType.Volleyball]: '@lucide.volleyball',
};
