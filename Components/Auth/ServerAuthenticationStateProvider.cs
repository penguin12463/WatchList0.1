using Microsoft.AspNetCore.Components.Authorization;
using System.Security.Claims;

namespace WatchList0._1.Components.Auth
{
    public class ServerAuthenticationStateProvider : AuthenticationStateProvider
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private AuthenticationState? _cachedAuthenticationState;

        public ServerAuthenticationStateProvider(IHttpContextAccessor httpContextAccessor)
        {
            _httpContextAccessor = httpContextAccessor;
        }

        public override Task<AuthenticationState> GetAuthenticationStateAsync()
        {
            var httpContext = _httpContextAccessor.HttpContext;
            
            if (httpContext?.User?.Identity?.IsAuthenticated == true)
            {
                var principal = httpContext.User;
                _cachedAuthenticationState = new AuthenticationState(principal);
                return Task.FromResult(_cachedAuthenticationState);
            }

            var unauthenticatedPrincipal = new ClaimsPrincipal(new ClaimsIdentity());
            _cachedAuthenticationState = new AuthenticationState(unauthenticatedPrincipal);
            return Task.FromResult(_cachedAuthenticationState);
        }

        public void NotifyAuthenticationStateChanged()
        {
            var authTask = GetAuthenticationStateAsync();
            NotifyAuthenticationStateChanged(authTask);
        }
    }
}
