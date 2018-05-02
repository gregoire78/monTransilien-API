# monTransilien-API
API récupérant les prochains départs d'une gare Transilien en Ile-de-France

N'hésitez pas à donner votre avis et des conseils 😉.

Exemple pour la gare de Clichy Levallois:

```json
{
    "station": "Clichy Levallois",
    "trains": [
        {
            "name": "PASA",
            "number": "133724",
            "terminus": "Paris Saint-Lazare",
            "expectedDepartureTime": "19:18",
            "aimedDepartureTime": "19:18",
            "journey": [
                {
                    "uic7": 8738111,
                    "name": "Pont Cardinet",
                    "dep_time": "19:21"
                },
                {
                    "uic7": 8738400,
                    "name": "Paris Saint-Lazare",
                    "dep_time": "19:24"
                }
            ],
            "route": {
                "id": "DUA8008540420004",
                "line": "L",
                "long_name": "Versailles Rive Droite - Gare Saint-Lazare",
                "color": "7584BC"
            },
            "late": "à l'heure",
            "journey_text": "Pont Cardinet • Paris Saint-Lazare",
            "text_monitor": "Le train PASA n°133724 prévu à 19h18 et à destination de Paris Saint-Lazare partira de la gare de Clichy Levallois dans 2 minutes"
        }
    ]
}
```

### Liens
[xOr](http://x0r.fr/) de
[monrer.fr](http://monrer.fr)

[Open Data SNCF](https://data.sncf.com/explore/?sort=modified)
