            "sharing": {

                "facebook": true,
              {% if site.facebook_username %}
                "facebook_link": "https://facebook.com/{{ site.facebook_username }}",
              {% else %}
                "facebook_link": "https://facebook.com",
              {% endif %}
                "google": false,

                "github": true,
              {% if site.github_username %}
                "github_link": "https://github.com/{{ site.github_username }}",
              {% else %}
                "github_link": "https://github.com",
              {% endif %}

                "twitter": true,
              {% if site.twitter_username %}
                "twitter_link": "https://twitter.com/{{ site.twitter_username }}",
              {% endif %}

            },
