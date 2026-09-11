import { liveLabels } from '../i18n/lang';

export enum Amenity {
  Restrooms = 'restrooms',
  Showers = 'showers',
  ChangingRooms = 'changing_rooms',
  Lockers = 'lockers',
  FreeParking = 'free_parking',
  PaidParking = 'paid_parking',
  HairDryers = 'hair_dryers',
  VendingMachines = 'vending_machines',
}

/** Labels stay RAW Georgian; `liveLabels` translates on every read. */
export const AMENITY_LABELS: Record<Amenity, string> = liveLabels({
  [Amenity.Restrooms]: 'საპირფარეშო',
  [Amenity.Showers]: 'შხაპი',
  [Amenity.ChangingRooms]: 'გამოსაცვლელი ოთახი',
  [Amenity.Lockers]: 'ლოქერი',
  [Amenity.FreeParking]: 'უფასო პარკინგი',
  [Amenity.PaidParking]: 'ფასიანი პარკინგი',
  [Amenity.HairDryers]: 'თმის ფენი',
  [Amenity.VendingMachines]: 'ვენდინგ მანქანა',
});

export const AMENITY_ICONS: Record<Amenity, string> = {
  [Amenity.Restrooms]: '@lucide.toilet',
  [Amenity.Showers]: '@lucide.shower-head',
  [Amenity.ChangingRooms]: '@lucide.shirt',
  [Amenity.Lockers]: '@lucide.lock',
  [Amenity.FreeParking]: '@lucide.circle-parking',
  [Amenity.PaidParking]: '@lucide.circle-parking',
  [Amenity.HairDryers]: '@lucide.zap',
  [Amenity.VendingMachines]: '@lucide.shopping-cart',
};
