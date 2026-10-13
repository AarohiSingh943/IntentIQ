"""Intentra's place taxonomy and how each category maps onto OpenStreetMap tags."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TagFilter:
    key: str
    values: tuple[str, ...]

    def overpass(self) -> str:
        if len(self.values) == 1:
            return f'["{self.key}"="{self.values[0]}"]'
        pattern = "|".join(self.values)
        return f'["{self.key}"~"^({pattern})$"]'

    def matches(self, tags: dict[str, str]) -> bool:
        return tags.get(self.key) in self.values


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    filters: tuple[TagFilter, ...]
    dwell_min: int
    indoor: bool = True
    energy: str = "mid"  # low | mid | high
    tags: tuple[str, ...] = field(default_factory=tuple)


def _f(key: str, *values: str) -> TagFilter:
    return TagFilter(key, tuple(values))


CATEGORIES: dict[str, Category] = {
    c.key: c
    for c in [
        Category("cafe", "Café", (_f("amenity", "cafe"),), 50, energy="low", tags=("coffee",)),
        Category("restaurant", "Restaurant", (_f("amenity", "restaurant"),), 75),
        Category("fast_food", "Quick food", (_f("amenity", "fast_food"),), 25, energy="mid"),
        Category("food_court", "Food court", (_f("amenity", "food_court"),), 40),
        Category("bar", "Bar", (_f("amenity", "bar", "pub", "biergarten"),), 60, energy="high"),
        Category("nightclub", "Club", (_f("amenity", "nightclub"),), 100, energy="high"),
        Category("ice_cream", "Ice cream", (_f("amenity", "ice_cream"),), 20, energy="low"),
        Category(
            "dessert",
            "Bakery & sweets",
            (_f("shop", "bakery", "pastry", "confectionery", "chocolate"),),
            25,
            energy="low",
        ),
        Category("park", "Park", (_f("leisure", "park", "garden"),), 45, indoor=False, energy="low"),
        Category(
            "nature",
            "Nature",
            (_f("leisure", "nature_reserve"), _f("natural", "beach")),
            60,
            indoor=False,
            energy="low",
        ),
        Category(
            "viewpoint", "Viewpoint", (_f("tourism", "viewpoint"),), 25, indoor=False, energy="low"
        ),
        Category("museum", "Museum", (_f("tourism", "museum", "gallery"),), 90, energy="low"),
        Category("attraction", "Attraction", (_f("tourism", "attraction"),), 40, indoor=False),
        Category(
            "monument",
            "Monument",
            (_f("historic", "monument", "memorial", "castle", "fort", "palace", "ruins"),),
            30,
            indoor=False,
            energy="low",
        ),
        Category("library", "Library", (_f("amenity", "library"),), 90, energy="low", tags=("quiet",)),
        Category(
            "coworking",
            "Coworking",
            (_f("amenity", "coworking_space"), _f("office", "coworking")),
            120,
            energy="low",
            tags=("wifi",),
        ),
        Category("cinema", "Cinema", (_f("amenity", "cinema"),), 130, energy="low"),
        Category("theatre", "Theatre", (_f("amenity", "theatre"),), 120, energy="low"),
        Category(
            "arcade",
            "Games",
            (_f("leisure", "amusement_arcade", "bowling_alley", "escape_game"),),
            75,
            energy="high",
        ),
        Category("bookshop", "Bookshop", (_f("shop", "books"),), 30, energy="low", tags=("quiet",)),
        Category("market", "Market", (_f("amenity", "marketplace"),), 40, indoor=False),
        Category("mall", "Mall", (_f("shop", "mall"),), 60),
        Category(
            "gym", "Gym", (_f("leisure", "fitness_centre", "sports_centre"),), 70, energy="high"
        ),
        Category(
            "swimming", "Swim", (_f("leisure", "swimming_pool", "water_park"),), 90, energy="high"
        ),
        Category("spa", "Spa", (_f("leisure", "spa"), _f("shop", "massage")), 75, energy="low"),
        Category(
            "playground", "Playground", (_f("leisure", "playground"),), 35, indoor=False, energy="high"
        ),
        Category(
            "zoo", "Zoo & parks", (_f("tourism", "zoo", "aquarium", "theme_park"),), 150, indoor=False
        ),
    ]
}

# Words a person might type that point straight at a category.
CATEGORY_SYNONYMS: dict[str, str] = {
    "cafe": "cafe",
    "café": "cafe",
    "coffee": "cafe",
    "coffee shop": "cafe",
    "restaurant": "restaurant",
    "dinner": "restaurant",
    "lunch": "restaurant",
    "brunch": "cafe",
    "breakfast": "cafe",
    "fast food": "fast_food",
    "burger": "fast_food",
    "pizza": "restaurant",
    "ramen": "restaurant",
    "sushi": "restaurant",
    "noodles": "restaurant",
    "curry": "restaurant",
    "biryani": "restaurant",
    "tacos": "restaurant",
    "kebab": "restaurant",
    "pasta": "restaurant",
    "steak": "restaurant",
    "seafood": "restaurant",
    "barbecue": "restaurant",
    "bbq": "restaurant",
    "dim sum": "restaurant",
    "pho": "restaurant",
    "thali": "restaurant",
    "dosa": "fast_food",
    "chai": "cafe",
    "tea": "cafe",
    "wine": "bar",
    "brewery": "bar",
    "rooftop bar": "bar",
    "lounge": "bar",
    "street food": "market",
    "bar": "bar",
    "pub": "bar",
    "beer": "bar",
    "drinks": "bar",
    "cocktail": "bar",
    "club": "nightclub",
    "nightclub": "nightclub",
    "dance": "nightclub",
    "ice cream": "ice_cream",
    "gelato": "ice_cream",
    "dessert": "dessert",
    "bakery": "dessert",
    "cake": "dessert",
    "park": "park",
    "garden": "park",
    "beach": "nature",
    "nature": "nature",
    "view": "viewpoint",
    "viewpoint": "viewpoint",
    "sunset": "viewpoint",
    "museum": "museum",
    "gallery": "museum",
    "art": "museum",
    "monument": "monument",
    "history": "monument",
    "historic": "monument",
    "castle": "monument",
    "fort": "monument",
    "library": "library",
    "coworking": "coworking",
    "cowork": "coworking",
    "cinema": "cinema",
    "movie": "cinema",
    "film": "cinema",
    "theatre": "theatre",
    "theater": "theatre",
    "play": "theatre",
    "arcade": "arcade",
    "bowling": "arcade",
    "escape room": "arcade",
    "games": "arcade",
    "bookshop": "bookshop",
    "bookstore": "bookshop",
    "books": "bookshop",
    "market": "market",
    "bazaar": "market",
    "mall": "mall",
    "shopping": "mall",
    "gym": "gym",
    "workout": "gym",
    "swim": "swimming",
    "pool": "swimming",
    "spa": "spa",
    "massage": "spa",
    "playground": "playground",
    "zoo": "zoo",
    "aquarium": "zoo",
    "theme park": "zoo",
}


def category_for_tags(tags: dict[str, str], wanted: list[str]) -> str | None:
    """Return the first wanted category whose filters match the element tags."""
    for key in wanted:
        cat = CATEGORIES.get(key)
        if cat and any(f.matches(tags) for f in cat.filters):
            return key
    return None
