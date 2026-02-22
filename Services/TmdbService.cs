using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using System.Text.Json.Serialization;
using System.Text.Json;

namespace WatchList0._1.Services
{
    public class TmdbService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _baseUrl;

        public TmdbService(HttpClient httpClient, IConfiguration config)
        {
            _httpClient = httpClient;
            _apiKey = config["TMDB:ApiKey"] ?? "";
            _baseUrl = config["TMDB:BaseUrl"] ?? "https://api.themoviedb.org/3/";
        }

        public async Task<TmdbSearchResult?> SearchAsync(string query)
        {
            var url = $"{_baseUrl}search/multi?api_key={_apiKey}&query={Uri.EscapeDataString(query)}";
            return await _httpClient.GetFromJsonAsync<TmdbSearchResult>(url);
        }

        public async Task<TmdbMovieDetails?> GetMovieDetailsAsync(int id)
        {
            var url = $"{_baseUrl}movie/{id}?api_key={_apiKey}";
            return await _httpClient.GetFromJsonAsync<TmdbMovieDetails>(url);
        }

        public async Task<TmdbTvDetails?> GetTvDetailsAsync(int id)
        {
            var url = $"{_baseUrl}tv/{id}?api_key={_apiKey}";
            return await _httpClient.GetFromJsonAsync<TmdbTvDetails>(url);
        }
    }

    public class TmdbSearchResult
    {
        [JsonPropertyName("results")]
        public List<TmdbSearchItem> Results { get; set; } = new();
    }

    public class TmdbSearchItem
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
        [JsonPropertyName("media_type")]
        public string MediaType { get; set; } = "";
        [JsonPropertyName("title")]
        public string? Title { get; set; }
        [JsonPropertyName("name")]
        public string? Name { get; set; }
    }

    public class TmdbMovieDetails
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
        [JsonPropertyName("title")]
        public string Title { get; set; } = "";
        [JsonPropertyName("runtime")]
        public int? Runtime { get; set; }
    }

    public class TmdbTvDetails
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
        [JsonPropertyName("name")]
        public string Name { get; set; } = "";
        [JsonPropertyName("number_of_episodes")]
        public int? NumberOfEpisodes { get; set; }
    }
}
