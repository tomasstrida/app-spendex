// Katalog ikon kategorií. Glyf z lucide-react zobrazený v barevném kruhu
// (struktura jako referenční mřížka). Klíč ikony se ukládá do categories.icon,
// barva do categories.color. Žádné nahrávání souborů — vše vektorové a malé.
import {
  User, Users, Car, Fuel, Wrench, Bus, Train, Plane, Bike,
  Drama, Film, Music, Gamepad2, Gift, Home, Smartphone, Wifi, Laptop, Tv,
  Heart, Pill, Stethoscope, Package, Shield, Landmark, CreditCard, Banknote,
  PiggyBank, Receipt, Wallet, TrendingUp, Utensils, Coffee, ShoppingCart,
  ShoppingBag, Shirt, Dumbbell, Volleyball, Sparkles, Scissors, Dog, Baby,
  GraduationCap, Briefcase, Building, Gem, Beer, Wine, Tag,
} from 'lucide-react';

// Pořadí = pořadí v pickeru (logicky seskupené).
export const CATALOG = [
  { key: 'User', label: 'Osoba', Icon: User },
  { key: 'Users', label: 'Lidé', Icon: Users },
  { key: 'Baby', label: 'Děti', Icon: Baby },
  { key: 'Dog', label: 'Zvíře', Icon: Dog },
  { key: 'Car', label: 'Auto', Icon: Car },
  { key: 'Fuel', label: 'Benzín', Icon: Fuel },
  { key: 'Wrench', label: 'Servis', Icon: Wrench },
  { key: 'Bus', label: 'MHD', Icon: Bus },
  { key: 'Train', label: 'Vlak', Icon: Train },
  { key: 'Plane', label: 'Letadlo', Icon: Plane },
  { key: 'Bike', label: 'Kolo', Icon: Bike },
  { key: 'Home', label: 'Bydlení', Icon: Home },
  { key: 'Smartphone', label: 'Mobil', Icon: Smartphone },
  { key: 'Wifi', label: 'Internet', Icon: Wifi },
  { key: 'Laptop', label: 'Počítač', Icon: Laptop },
  { key: 'Tv', label: 'TV', Icon: Tv },
  { key: 'Utensils', label: 'Restaurace', Icon: Utensils },
  { key: 'Coffee', label: 'Kávička', Icon: Coffee },
  { key: 'Beer', label: 'Pivo', Icon: Beer },
  { key: 'Wine', label: 'Víno', Icon: Wine },
  { key: 'ShoppingCart', label: 'Nákupy', Icon: ShoppingCart },
  { key: 'ShoppingBag', label: 'Nákup 2', Icon: ShoppingBag },
  { key: 'Shirt', label: 'Oblečení', Icon: Shirt },
  { key: 'Gift', label: 'Dárky', Icon: Gift },
  { key: 'Drama', label: 'Zábava', Icon: Drama },
  { key: 'Film', label: 'Film', Icon: Film },
  { key: 'Music', label: 'Hudba', Icon: Music },
  { key: 'Gamepad2', label: 'Hry', Icon: Gamepad2 },
  { key: 'Dumbbell', label: 'Sport', Icon: Dumbbell },
  { key: 'Volleyball', label: 'Volejbal', Icon: Volleyball },
  { key: 'Heart', label: 'Zdraví', Icon: Heart },
  { key: 'Pill', label: 'Léky', Icon: Pill },
  { key: 'Stethoscope', label: 'Lékař', Icon: Stethoscope },
  { key: 'Sparkles', label: 'Beauty', Icon: Sparkles },
  { key: 'Scissors', label: 'Kadeřník', Icon: Scissors },
  { key: 'GraduationCap', label: 'Vzdělání', Icon: GraduationCap },
  { key: 'Briefcase', label: 'Práce', Icon: Briefcase },
  { key: 'Building', label: 'Firma', Icon: Building },
  { key: 'Package', label: 'Drahé věci', Icon: Package },
  { key: 'Gem', label: 'Luxus', Icon: Gem },
  { key: 'Shield', label: 'Pojištění', Icon: Shield },
  { key: 'Landmark', label: 'Banka', Icon: Landmark },
  { key: 'CreditCard', label: 'Karta', Icon: CreditCard },
  { key: 'Banknote', label: 'Peníze', Icon: Banknote },
  { key: 'Wallet', label: 'Peněženka', Icon: Wallet },
  { key: 'PiggyBank', label: 'Spoření', Icon: PiggyBank },
  { key: 'Receipt', label: 'Platby', Icon: Receipt },
  { key: 'TrendingUp', label: 'Příjmy', Icon: TrendingUp },
  { key: 'Tag', label: 'Štítek', Icon: Tag },
];

const BY_KEY = Object.fromEntries(CATALOG.map(c => [c.key, c.Icon]));

export function iconComponent(key) {
  return BY_KEY[key] || Tag;
}

// Ikona kategorie = glyf v barevném kruhu.
export function CategoryIcon({ icon, color, size = 22 }) {
  const Icon = iconComponent(icon);
  const box = Math.round(size * 1.9);
  return (
    <span
      className="cat-glyph"
      style={{ width: box, height: box, background: color || '#6366f1' }}
    >
      <Icon size={size} color="#fff" strokeWidth={2.2} />
    </span>
  );
}
