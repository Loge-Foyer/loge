import { useLocalSearchParams } from 'expo-router';

import { CategoryScreen } from '@/screens/settings/plugins';
import { categoryParam } from '@/screens/settings/plugin-route';

export default function Category() {
  const { category } = useLocalSearchParams<{ category: string }>();
  return <CategoryScreen category={categoryParam(category)} />;
}
