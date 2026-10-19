import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { queryKeys } from "./queryKeys";

export type Category = {
  id: string;
  name: string;
  category_type: "income" | "expense";
  is_system: boolean;
};

export function useCategories(type?: "income" | "expense") {
  return useQuery({
    queryKey: queryKeys.categories(type),
    queryFn: async () => {
      const query = type ? `?type=${type}` : "";
      return (await api<{ items: Category[] }>(`/categories${query}`)).items;
    },
    staleTime: 5 * 60 * 1000, // built-in categories rarely change
  });
}
