# Chujowy Launcher

Osobny launcher dla zarzadzanej instancji Among Us z:

- Town of Us: Mira
- TownOfUsMegaChujoweExtension
- AleLuduMod

Launcher nie pobiera platnej gry z internetu. Tworzy osobna instancje na podstawie lokalnie wskazanego folderu legalnej instalacji Among Us, a nastepnie pobiera i aktualizuje warstwe modow z GitHub Releases.

## Przeplyw

1. Wybierz platforme `Steam` albo `Epic`.
2. Dla Steam launcher sprobuje wykryc gre sam, a `Wykryj Steam` ponowi skan.
3. Dla Epic kliknij `Pobierz Legendary`, potem `Zaloguj Epic`, `Sprawdz Epic`, a nastepnie `Wykryj Epic`.
4. Jesli automatyka nie wystarczy, nadal mozna wskazac folder z `Among Us.exe` recznie.
5. Kliknij `Przygotuj instancje`.
6. Kliknij `Aktualizuj mody`.
7. Kliknij `Uruchom gre`.

## Start

```powershell
.\start-amongus.ps1
```
